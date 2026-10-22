// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// MarkdownEditor keeps a list whose item holds a block through ordinary edits
// (plans/markdown-editor-list-item-block-paste.md): what a load builds, an
// edit must not turn into a document whose save reads as something else. After
// every step the save loads as the document the editor shows, and the viewer
// reads it the same way.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    $createRangeSelection, $createTextNode, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isTextNode, $setSelection,
    CONTROLLED_TEXT_INSERTION_COMMAND, DELETE_CHARACTER_COMMAND, DELETE_LINE_COMMAND, INDENT_CONTENT_COMMAND, INSERT_LINE_BREAK_COMMAND,
    INSERT_TAB_COMMAND, KEY_BACKSPACE_COMMAND, KEY_ENTER_COMMAND, OUTDENT_CONTENT_COMMAND,
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
 * `outdent` is `OUTDENT_CONTENT_COMMAND`, its counterpart, which a host can
 * dispatch too; `Backspace key` is the key itself (`KEY_BACKSPACE_COMMAND`),
 * which at the start of a list item moves the item out through the item's
 * own `collapseAtStart`, and is a deletion anywhere else.
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
const TEXT_ONLY_BLOCKS: readonly string[] = ['paragraph', 'markdown-list-item-text', 'heading', 'quote', 'code', 'markdown-raw-block'];

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
            shape:  'markdown-raw-block("[d]: /a") | list(markdown-list-item(markdown-raw-block("[d]: /b"), markdown-raw-block("[d]: /c")))',
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
            shape:  'list(markdown-list-item(markdown-raw-block("[a]: /u", linebreak, "[b]: /v")), markdown-list-item(markdown-list-item-text("c")))',
        },
        {
            name:   'D4: two repeated definitions on consecutive lines are one raw block too',
            source: '[x]: /a\n\n- [x]: /b\n  [x]: /c\n- c',
            steps:  [],
            shape:  'markdown-raw-block("[x]: /a") | list(markdown-list-item(markdown-raw-block("[x]: /b", linebreak, "[x]: /c")), markdown-list-item(markdown-list-item-text("c")))',
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
            shape:  'list(markdown-list-item(markdown-raw-block("[x]: /b", linebreak, "[y]: /c")), markdown-list-item(markdown-list-item-text("c")))',
        },
        {
            name:   'D8: Enter between two definition lines of an item makes them two raw blocks and the list loose',
            source: '[x]: /a\n\n- [x]: /b\n  [x]: /c\n- c',
            steps:  [{ key: 'Enter', at: ['[x]: /b', 7] }],
            saved:  '[x]: /a\n\n- [x]: /b\n\n  [x]: /c\n\n- c',
            shape:  'markdown-raw-block("[x]: /a") | list(markdown-list-item(markdown-raw-block("[x]: /b"), markdown-raw-block("[x]: /c")), markdown-list-item(markdown-list-item-text("c")))',
        },
        {
            name:   'D9: three repeated definitions after an item\'s text, the last a blank line apart',
            source: '[d]: /a\n\n- t\n\n  [d]: /b\n  [d]: /c\n\n  [d]: /e\n\n- z',
            steps:  [{ key: 'type', text: 'X', at: ['z', 1] }],
            shape:  'markdown-raw-block("[d]: /a") | list(markdown-list-item(markdown-list-item-text("t"), markdown-raw-block("[d]: /b", linebreak, "[d]: /c"), markdown-raw-block("[d]: /e")), markdown-list-item(markdown-list-item-text("zX")))',
        },
    ])('$name', runRow);

    it.each<[string, string, string]>([
        ['D12: a repeated definition whose title holds a blank line, at the top level', '[d]: /a\n\n[d]: /b "ti\n\ntle"',
            'markdown-raw-block("[d]: /a") | markdown-raw-block("[d]: /b \\"ti", linebreak, linebreak, "tle\\"")'],
        ['D13: a repeated definition whose label holds a blank line', '[fo\n\no]: /a\n\n[fo\n\no]: /b',
            'markdown-raw-block("[fo", linebreak, linebreak, "o]: /a") | markdown-raw-block("[fo", linebreak, linebreak, "o]: /b")'],
        ['D14: a repeated definition whose title holds a blank line, under an item\'s text', '[d]: /a\n\n- t\n\n  [d]: /b "ti\n\n  tle"\n\n- z',
            'markdown-raw-block("[d]: /a") | list(markdown-list-item(markdown-list-item-text("t"), markdown-raw-block("[d]: /b \\"ti", linebreak, linebreak, "tle\\"")), markdown-list-item(markdown-list-item-text("z")))'],
        ['D15: the same opening an item of a tight list', '[d]: /a\n\n- [d]: /b "ti\n\n  tle"\n- z',
            'markdown-raw-block("[d]: /a") | list(markdown-list-item(markdown-raw-block("[d]: /b \\"ti", linebreak, linebreak, "tle\\"")), markdown-list-item(markdown-list-item-text("z")))'],
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
    /** Raw lists: each holds a block right under an item's text in a tight list, so it loads as no list. */
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

        expect(shapeOf(editor)).toBe('list(markdown-list-item(markdown-list-item-text("a"), quote("q"), markdown-raw-block("<div")), markdown-list-item(markdown-list-item-text("z")))');
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
            shape:  'paragraph("p1w0") | markdown-raw-block("---") | list(markdown-list-item(markdown-list-item-text("z")))',
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
            shape:  'paragraph("pw0") | quote("q") | markdown-raw-block("---") | list(markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            // A join joins text, here as outside a list: the item's text joins the quote, and its blocks follow into the item.
            name:   'K3: an item ending in a quote, Backspace at the start of the next item: its text joins the quote, its blocks the item',
            source: '- a\n\n  > q0\n\n- w2\n\n  ::: {align=center}\n  f3\n  :::\n\n  <!-- c4 -->',
            steps:  [{ key: 'Backspace', at: ['w2', 0] }],
            saved:  '- a\n\n  > q0w2\n\n  ::: {align=center}\n  f3\n  :::\n\n  <!-- c4 -->',
            shape:  'list(markdown-list-item(markdown-list-item-text("a"), quote("q0w2"), markdown-block(markdown-column(paragraph("f3"))), markdown-raw-block("<!-- c4 -->")))',
        },
        {
            name:   'K4: an item that is a heading, Backspace at the start of the next item',
            source: '1. w0\n2. # h1\n3. w2\n\n   <div>',
            steps:  [{ key: 'Backspace', at: ['w2', 0] }],
            saved:  '1. w0\n\n2. # h1w2\n\n   <div>',
            shape:  'list(markdown-list-item(markdown-list-item-text("w0")), markdown-list-item(heading("h1w2"), markdown-raw-block("<div>")))',
        },
        {
            name:   'K5: an item\'s second paragraph, Delete at its end: the next item\'s text joins the paragraph, its blocks the item',
            source: '1. a\n\n   w4\n2. w5\n\n   | h |\n   | --- |\n   | c |',
            steps:  [{ key: 'Delete', at: ['w4', 2] }],
            saved:  '1. a\n\n   w4w5\n\n   | h |\n   | --- |\n   | c |',
            shape:  `list(markdown-list-item(markdown-list-item-text("a"), paragraph("w4w5"), ${TABLE}))`,
        },
        {
            // The item before is the last one of the list before, a list of another kind: it takes the blocks as in K5.
            name:   'K5b: the last item of a bullet list, Delete at its end before an ordered list: the first item\'s text joins it, its blocks the item',
            source: '- a\n\n1. w5\n\n   p\n   1. n\n2. z',
            steps:  [{ key: 'Delete', at: ['a', 1] }],
            saved:  '- aw5\n\n  p\n\n  1. n\n\n1. z',
            shape:  'list(markdown-list-item(markdown-list-item-text("aw5"), paragraph("p"), list(markdown-list-item(markdown-list-item-text("n"))))) | list(markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'K6: a paragraph, Backspace at the start of an item holding a second paragraph and a nested list',
            source: 'p\n\n- a\n\n  b\n\n  - n\n- z',
            steps:  [{ key: 'Backspace', at: ['a', 0] }],
            saved:  'pa\n\nb\n\n- - n\n\n- z',
            shape:  'paragraph("pa") | paragraph("b") | list(markdown-list-item(list(markdown-list-item(markdown-list-item-text("n")))), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'K7: a quote, Backspace at the start of the item after it',
            source: '> q\n\n- w0\n\n  ---\n- z',
            steps:  [{ key: 'Backspace', at: ['w0', 0] }],
            saved:  '> qw0\n\n---\n\n- z',
            shape:  'quote("qw0") | markdown-raw-block("---") | list(markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'K8: a heading, Delete at its end',
            source: '# h\n\n- w0\n\n  ---\n- z',
            steps:  [{ key: 'Delete', at: ['h', 1] }],
            saved:  '# hw0\n\n---\n\n- z',
            shape:  'heading("hw0") | markdown-raw-block("---") | list(markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'K9: a code block, Delete at its end before an item holding a table',
            source: '```\ncode\n```\n\n- w0\n\n  | h |\n  | --- |\n  | c |\n- z',
            steps:  [{ key: 'Delete', at: ['code', 4] }],
            saved:  '```\ncodew0\n```\n\n| h |\n| --- |\n| c |\n\n- z',
            shape:  `code("codew0") | ${TABLE} | list(markdown-list-item(markdown-list-item-text("z")))`,
        },
        {
            name:   'K10: a raw block, Delete at its end before an item holding an HTML block',
            source: '<div>\n\n- w0\n\n  <p>\n  x\n  </p>\n- z',
            steps:  [{ key: 'Delete', at: ['<div>', 5] }],
            saved:  '<div>w0\n\n<p>\nx\n</p>\n\n- z',
            shape:  'markdown-raw-block("<div>w0") | markdown-raw-block("<p>", linebreak, "x", linebreak, "</p>") | list(markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'K11: a code block, Backspace at the start of the item after it',
            source: '```\ncode\n```\n\n- w0\n\n  ---\n- z',
            steps:  [{ key: 'Backspace', at: ['w0', 0] }],
            saved:  '```\ncodew0\n```\n\n---\n\n- z',
            shape:  'code("codew0") | markdown-raw-block("---") | list(markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'K12: a range deleted from inside a code block into the text of an item',
            source: '```\ncode\n```\n\n- w0\n\n  ---\n- z',
            steps:  [{ key: 'Backspace', at: ['code', 2], to: ['w0', 1] }],
            saved:  '```\nco0\n```\n\n---\n\n- z',
            shape:  'code("co0") | markdown-raw-block("---") | list(markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'K13: a range deleted from inside a raw block into the text of an item',
            source: '<div>\n\n- w0\n\n  ---\n- z',
            steps:  [{ key: 'Backspace', at: ['<div>', 2], to: ['w0', 1] }],
            saved:  '\\<d0\n\n---\n\n- z',
            shape:  'paragraph("<d0") | markdown-raw-block("---") | list(markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'K14: a range deleted from inside a code block into the text of an item holding two more blocks and a nested list',
            source: '```\ncode\n```\n\n- w0\n\n  > q\n\n  p\n\n  - n\n- z',
            steps:  [{ key: 'Backspace', at: ['code', 2], to: ['w0', 1] }],
            shape:  'code("co0") | quote("q") | paragraph("p") | list(markdown-list-item(list(markdown-list-item(markdown-list-item-text("n")))), markdown-list-item(markdown-list-item-text("z")))',
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

    it('K21: a list item\'s text given blocks between its text has the rest follow it as blocks of the item', () => {
        const editor = load('- a\n- z');

        lexicalOf(editor).update(() => {
            const text = $textNode('a').getParentOrThrow();
            const quote = $createQuoteNode().append($createTextNode('q'));

            text.splice(text.getChildrenSize(), 0, [$createMarkdownRawBlockNode('---'), $createTextNode('b'), quote, $createTextNode('c')]);
        }, { discrete: true });

        expect(shapeOf(editor)).toBe('list(markdown-list-item(markdown-list-item-text("a"), markdown-raw-block("---"), paragraph("b"), quote("q"), paragraph("c")), markdown-list-item(markdown-list-item-text("z")))');
        expect(expectSaveKeepsDocument(editor, 'the blocks put in')).toBe('- a\n\n  ---\n\n  b\n\n  > q\n\n  c\n\n- z');
    });

    it('K22: a range from inside a code block to a point between the blocks of a list item takes the item\'s blocks before it, and the rest follow', () => {
        const editor = load('```\ncode\n```\n\n- w0\n\n  ---\n\n  p\n- z');

        lexicalOf(editor).update(() => {
            const selection = $createRangeSelection();

            // A point on the item itself, after its text: only a selection made in code holds one.
            selection.anchor.set($textNode('code').getKey(), 2, 'text');
            selection.focus.set($textNode('w0').getParentOrThrow().getParentOrThrow().getKey(), 1, 'element');
            $setSelection(selection);
        }, { discrete: true });
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);

        expect(shapeOf(editor)).toBe('code("co") | markdown-raw-block("---") | paragraph("p") | list(markdown-list-item(markdown-list-item-text("z")))');
        expectSaveKeepsDocument(editor, 'the range deleted');
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
        {
            name:   'L6: the text of a loose list\'s only item is deleted, which leaves the item one block',
            source: '- a\n\n  - n',
            steps:  [{ key: 'Backspace', at: ['a', 0], to: ['a', 1] }],
            saved:  '- - n',
        },
        {
            name:   'L7: an item\'s paragraph is typed over with a space, which writes nothing',
            source: '- a\n\n  pq',
            steps:  [{ key: 'type', text: ' ', at: ['pq', 0], to: ['pq', 2] }],
            saved:  '- a',
        },
        {
            name:   'L8: the text of a loose list\'s only item is typed over with a space',
            source: '- a\n\n  - n',
            steps:  [{ key: 'type', text: ' ', at: ['a', 0], to: ['a', 1] }],
        },
        {
            // The text node changes in place, so no block is written: the text's own rule reads the looseness.
            name:   'L9: an item\'s paragraph is deleted down to a space, character by character',
            source: '- a\n\n  p q',
            steps:  [{ key: 'Backspace', at: ['p q', 0], to: ['p q', 1] }, { key: 'Backspace', at: [' q', 1], to: [' q', 2] }],
            saved:  '- a',
        },
        {
            name:   'L10: the text of a loose list\'s only item is deleted down to a space, character by character',
            source: '- a b\n\n  - n',
            steps:  [{ key: 'Backspace', at: ['a b', 0], to: ['a b', 1] }, { key: 'Backspace', at: [' b', 1], to: [' b', 2] }],
        },
        {
            // A blank text writes nothing, so the item was one block; with text typed into it the item is two, and
            // the list reads loose.
            name:   'L11: text typed into a blank item text over a paragraph, in a tight list of several items, makes the list loose',
            source: '- a\n  - bc\n\n    pq\n- z',
            steps:  [{ key: 'type', text: ' ', at: ['bc', 0], to: ['bc', 2] }, { key: 'Enter' }, { key: 'type', text: 'Q' }],
            saved:  '- a\n\n- Q\n\n  pq\n\n- z',
        },
        {
            name:   'L12: the same after the Backspace key moved the item out',
            source: '- a\n  - bc\n\n    pq\n- z',
            steps:  [{ key: 'type', text: ' ', at: ['bc', 0], to: ['bc', 2] }, { key: 'Backspace key', at: [' ', 0] }, { key: 'type', text: 'Q' }],
            saved:  '- a\n\n- Q\n\n  pq\n\n- z',
        },
        {
            name:   'L13: the same over a heading',
            source: '- a\n  - bc\n\n    ## hh\n- z',
            steps:  [{ key: 'type', text: ' ', at: ['bc', 0], to: ['bc', 2] }, { key: 'Enter' }, { key: 'type', text: 'Q' }],
            saved:  '- a\n\n- Q\n\n  ## hh\n\n- z',
        },
        {
            name:   'L15: text typed after a blank in a paragraph put under an item of a tight list makes the list loose',
            source: '- a\n  - b\n- c',
            steps:  [
                { key: 'command', run: (editor) => editor.insertParagraphAfterBlock(), at: ['b', 1] },
                { key: 'type', text: ' ' },
                { key: 'type', text: 'Q' },
            ],
            saved:  '- a\n  - b\n\n  Q\n\n- c',
        },
        {
            name:   'L16: the raw block of a loose list\'s only item is typed over with a space, which leaves the item one block',
            source: '- a\n\n  <div>',
            steps:  [{ key: 'type', text: ' ', at: ['<div>', 0], to: ['<div>', 5] }],
            saved:  '- a',
        },
        {
            name:   'L14: the typed text deleted again leaves a list its save can write',
            source: '- a\n  - bc\n\n    pq\n- z',
            steps:  [{ key: 'type', text: ' ', at: ['bc', 0], to: ['bc', 2] }, { key: 'Enter' }, { key: 'type', text: 'Q' }, { key: 'Backspace' }],
        },
    ])('$name', runRow);
});

describe('an item an edit leaves opening with a nested list stays an item, and the raw block that ends the item before it a raw block', () => {
    // An item that opens with a list is an item of its own (`- - n`), so its list is no block after the raw block.
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

        expect(shapeOf(editor)).toContain('markdown-raw-block("<!-- c")');
        expect(shapeOf(editor)).toContain('markdown-list-item(list(markdown-list-item(markdown-list-item-text("n"))))');
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
            shape:  'heading("h[x] w4") | quote("q5") | list(markdown-list-item(markdown-list-item-text("d")))',
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
            shape:  'heading("[x] w4") | quote("q5") | list(markdown-list-item(markdown-list-item-text("d")))',
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
    // The outer item's blocks after a nested list follow that list in the document, so they follow an item that
    // leaves the list as its last one. Backspace at the start of a nested item moves it out one level, and a
    // block type set on it takes it out of every list first.
    it.each<Row>([
        {
            name:   'U1: Backspace at the start of the only nested item',
            source: '- a\n  - b\n\n  c\n- d',
            steps:  [{ key: 'Backspace key', at: ['b', 0] }],
            saved:  '- a\n\n- b\n\n  c\n\n- d',
            shape:  'list(markdown-list-item(markdown-list-item-text("a")), markdown-list-item(markdown-list-item-text("b"), paragraph("c")), markdown-list-item(markdown-list-item-text("d")))',
        },
        {
            name:   'U2: the outdent command on the last nested item of two',
            source: '- a\n  - x\n  - b\n\n  c\n- d',
            steps:  [{ key: 'outdent', at: ['b', 1] }],
            saved:  '- a\n  - x\n\n- b\n\n  c\n\n- d',
            shape:  'list(markdown-list-item(markdown-list-item-text("a"), list(markdown-list-item(markdown-list-item-text("x")))), markdown-list-item(markdown-list-item-text("b"), paragraph("c")), markdown-list-item(markdown-list-item-text("d")))',
        },
        {
            name:   'U3: the first nested item of two: the block stays after the rest of the nested list',
            source: '- a\n  - b\n  - x\n\n  c\n- d',
            steps:  [{ key: 'outdent', at: ['b', 1] }],
            saved:  '- a\n\n- b\n  - x\n\n  c\n\n- d',
            shape:  'list(markdown-list-item(markdown-list-item-text("a")), markdown-list-item(markdown-list-item-text("b"), list(markdown-list-item(markdown-list-item-text("x"))), paragraph("c")), markdown-list-item(markdown-list-item-text("d")))',
        },
        {
            name:   'U4: the middle nested item of three: the block stays after the items that followed it',
            source: '- a\n  - x\n  - b\n  - y\n\n  c\n- d',
            steps:  [{ key: 'outdent', at: ['b', 1] }],
            saved:  '- a\n  - x\n\n- b\n  - y\n\n  c\n\n- d',
            shape:  'list(markdown-list-item(markdown-list-item-text("a"), list(markdown-list-item(markdown-list-item-text("x")))), markdown-list-item(markdown-list-item-text("b"), list(markdown-list-item(markdown-list-item-text("y"))), paragraph("c")), markdown-list-item(markdown-list-item-text("d")))',
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
            shape:  'list(markdown-list-item(markdown-list-item-text("a")), markdown-list-item(markdown-list-item-text("b"), quote("q"), paragraph("c")), markdown-list-item(markdown-list-item-text("d")))',
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
            '- a\n\n## b\n\nc\n\n- d', 'list(markdown-list-item(markdown-list-item-text("a"))) | heading("b") | paragraph("c") | list(markdown-list-item(markdown-list-item-text("d")))'],
        ['U10: a paragraph', '- a\n  - b\n\n  c\n- d', (editor) => editor.setBlockType('paragraph'), ['b', 1], ['b', 1],
            '- a\n\nb\n\nc\n\n- d', 'list(markdown-list-item(markdown-list-item-text("a"))) | paragraph("b") | paragraph("c") | list(markdown-list-item(markdown-list-item-text("d")))'],
        ['U11: the list toggled off', '- a\n  - b\n\n  c\n- d', (editor) => editor.toggleUnorderedList(), ['b', 1], ['b', 1],
            '- a\n\nb\n\nc\n\n- d', 'list(markdown-list-item(markdown-list-item-text("a"))) | paragraph("b") | paragraph("c") | list(markdown-list-item(markdown-list-item-text("d")))'],
        ['U12: a code block', '- a\n  - b\n\n  c\n- d', (editor) => editor.setBlockType('code'), ['b', 1], ['b', 1],
            '- a\n\n```\nb\n```\n\nc\n\n- d', 'list(markdown-list-item(markdown-list-item-text("a"))) | code("b") | paragraph("c") | list(markdown-list-item(markdown-list-item-text("d")))'],
        ['U13: a quote over a range from the nested item\'s quote to the outer item\'s headings',
            '- a\n  - b\n\n    > q\n\n  ## g\n\n  ## h\n- d', (editor) => editor.setBlockType('quote'), ['q', 1], ['h', 1],
            // `b` is not in the selection: its item stays where it is, and each selected block takes the type in place.
            '- a\n  - b\n\n    > q\n\n  > g\n\n  > h\n\n- d',
            'list(markdown-list-item(markdown-list-item-text("a"), list(markdown-list-item(markdown-list-item-text("b"), quote("q"))), quote("g"), quote("h")), '
            + 'markdown-list-item(markdown-list-item-text("d")))'],
        ['U14: two levels deep', '- a\n  - m\n    - b\n\n    c\n\n  e\n- d', (editor) => editor.setBlockType('h2'), ['b', 1], ['b', 1],
            '- a\n\n  - m\n\n## b\n\nc\n\ne\n\n- d', ''],
    ])('%s set on a nested item', (_name, source, run, at, to, saved, shape) => {
        const editor = load(source);

        press(editor, { key: 'command', run, at, to });

        expect(expectSaveKeepsDocument(editor, 'the command')).toBe(saved);
        // The block that leaves the lists takes no indent from the depth its item had.
        expect(lexicalOf(editor).read(() => $getRoot().getChildren().filter($isElementNode).every((block) => block.getIndent() === 0))).toBe(true);

        if (shape !== '') {
            expect(shapeOf(editor)).toBe(shape);
        }
    });
});

describe('a code block made of a list item takes the item\'s text and leaves its blocks after it', () => {
    it.each<[string, string, TextPoint, TextPoint, string, string]>([
        ['C1: an item holding a paragraph', '- a\n\n  p\n- d', ['a', 1], ['a', 1],
            '```\na\n```\n\np\n\n- d', 'code("a") | paragraph("p") | list(markdown-list-item(markdown-list-item-text("d")))'],
        ['C2: an item holding a table', '- a\n\n  | h |\n  | --- |\n  | c |\n- d', ['a', 1], ['a', 1],
            '```\na\n```\n\n| h |\n| --- |\n| c |\n\n- d', ''],
        ['C3: formatted text and a quote', '- **a** b\n\n  > q\n- d', ['a', 1], ['a', 1],
            '```\n**a** b\n```\n\n> q\n\n- d', ''],
        ['C4: a range from the item\'s text into its paragraph', '- a\n\n  p\n- d', ['a', 0], ['p', 1],
            '```\na\n```\n\n```\np\n```\n\n- d', 'code("a") | code("p") | list(markdown-list-item(markdown-list-item-text("d")))'],
        ['C5: an item of text only (control)', '- a\n- d', ['a', 1], ['a', 1], '```\na\n```\n\n- d', 'code("a") | list(markdown-list-item(markdown-list-item-text("d")))'],
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
    // An item's text is a block of its own, so Lexical edits it as one: Enter splits the item there, the blocks
    // after the text going to the new item, and what is typed or pasted over all of the text replaces that text
    // and nothing else.
    it.each<Row>([
        {
            name:   'T1: Enter inside the text: the blocks go with the text after the caret',
            source: '- wx\n\n  p2\n- z',
            steps:  [{ key: 'Enter', at: ['wx', 1] }],
            saved:  '- w\n\n- x\n\n  p2\n\n- z',
            shape:  'list(markdown-list-item(markdown-list-item-text("w")), markdown-list-item(markdown-list-item-text("x"), paragraph("p2")), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'T2: Enter at the start of the text',
            source: '- wx\n\n  p2\n- z',
            steps:  [{ key: 'Enter', at: ['wx', 0] }],
            shape:  'list(markdown-list-item(markdown-list-item-text()), markdown-list-item(markdown-list-item-text("wx"), paragraph("p2")), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            // Nothing of the item's text follows the caret: its first paragraph is the new item's text, as its
            // save reads (Markdown has no item whose first line is empty over a paragraph).
            name:   'T3: Enter at the end of the text',
            source: '- wx\n\n  p2\n- z',
            steps:  [{ key: 'Enter', at: ['wx', 2] }],
            saved:  '- wx\n\n- p2\n\n- z',
            shape:  'list(markdown-list-item(markdown-list-item-text("wx")), markdown-list-item(markdown-list-item-text("p2")), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'T4: Enter in an item holding two paragraphs',
            source: '- wx\n\n  p2\n\n  p3',
            steps:  [{ key: 'Enter', at: ['wx', 1] }],
            saved:  '- w\n\n- x\n\n  p2\n\n  p3',
            shape:  'list(markdown-list-item(markdown-list-item-text("w")), markdown-list-item(markdown-list-item-text("x"), paragraph("p2"), paragraph("p3")))',
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
            shape:  'list(markdown-list-item(markdown-list-item-text("w")), markdown-list-item(markdown-list-item-text("y"), paragraph("p2")))',
        },
        {
            name:   'T7: Enter in the text of an item whose nested list a paragraph follows',
            source: '- wx\n  - n\n\n  p2\n- z',
            steps:  [{ key: 'Enter', at: ['wx', 1] }],
            shape:  'list(markdown-list-item(markdown-list-item-text("w")), markdown-list-item(markdown-list-item-text("x"), list(markdown-list-item(markdown-list-item-text("n"))), paragraph("p2")), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'T8: typing over all of the text',
            source: '- a\n\n  p\n- z',
            steps:  [{ key: 'type', text: 'Q', at: ['a', 0], to: ['a', 1] }],
            saved:  '- Q\n\n  p\n\n- z',
            shape:  'list(markdown-list-item(markdown-list-item-text("Q"), paragraph("p")), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'T9: typing over all of the text of an item holding an HTML block',
            source: '- a\n\n  <div>\n- b',
            steps:  [{ key: 'type', text: 'Q', at: ['a', 0], to: ['a', 1] }],
            saved:  '- Q\n\n  <div>\n\n- b',
            shape:  'list(markdown-list-item(markdown-list-item-text("Q"), markdown-raw-block("<div>")), markdown-list-item(markdown-list-item-text("b")))',
        },
        {
            name:   'T10: typing over part of the text (control)',
            source: '- abc\n\n  p\n- z',
            steps:  [{ key: 'type', text: 'Q', at: ['abc', 1], to: ['abc', 2] }],
            shape:  'list(markdown-list-item(markdown-list-item-text("aQc"), paragraph("p")), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            // The item's text is gone, so its first paragraph is its text now: the save reads `- p`.
            name:   'T11: Backspace over all of the text',
            source: '- a\n\n  p\n- z',
            steps:  [{ key: 'Backspace', at: ['a', 0], to: ['a', 1] }],
            saved:  '- p\n\n- z',
            shape:  'list(markdown-list-item(markdown-list-item-text("p")), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'T12: Backspace over all of the text of an item holding two paragraphs, then typing',
            source: '- a\n\n  p\n\n  r\n- z',
            steps:  [{ key: 'Backspace', at: ['a', 0], to: ['a', 1] }, { key: 'type', text: 'Q' }],
            saved:  '- Qp\n\n  r\n\n- z',
            shape:  'list(markdown-list-item(markdown-list-item-text("Qp"), paragraph("r")), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'T13: Enter over a range from the item before into the text',
            source: '- a\n- w2\n\n  p\n- z',
            steps:  [{ key: 'Enter', at: ['a', 1], to: ['w2', 1] }],
            saved:  '- a\n\n- 2\n\n  p\n\n- z',
            shape:  'list(markdown-list-item(markdown-list-item-text("a")), markdown-list-item(markdown-list-item-text("2"), paragraph("p")), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'T14: Enter over a range from a paragraph before the list into the text',
            source: 'k\n\n- w2\n\n  p\n- z',
            steps:  [{ key: 'Enter', at: ['k', 0], to: ['w2', 1] }],
            saved:  '2\n\np\n\n- z',
        },
        {
            // The join puts the next item's text into the paragraph; Enter there splits the paragraph, in the item.
            name:   'T15: Enter in a paragraph of an item that the next item\'s text was joined to',
            source: '- w0\n\n  p1\n- w2',
            steps:  [{ key: 'Delete', at: ['p1', 2] }, { key: 'Enter', at: ['p1w2', 3] }],
            saved:  '- w0\n\n  p1w\n\n  2',
        },
    ])('$name', runRow);
});

describe('a range that takes everything a list item holds leaves no list without an item', () => {
    // A range from an item's text to the end of a block the item holds leaves the item, emptied, holding the caret,
    // as a range over two items of text does (X8): the text the range started in stays. A list left with no item is
    // no document a save can write.
    it.each<Row>([
        {
            name:   'X1: Backspace over the only item: an empty item holds the caret, as after a list of text items',
            source: '- w0\n\n  p1',
            steps:  [{ key: 'Backspace', at: ['w0', 0], to: ['p1', 2] }, { key: 'type', text: 'X' }],
            saved:  '- X',
            shape:  'list(markdown-list-item(markdown-list-item-text("X")))',
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
            name:   'X4: Backspace over the last item of two leaves it empty, and it takes what is typed',
            source: '- k\n- w2\n\n  p3',
            steps:  [{ key: 'Backspace', at: ['w2', 0], to: ['p3', 2] }, { key: 'type', text: 'X' }],
            saved:  '- k\n\n- X',
            shape:  'list(markdown-list-item(markdown-list-item-text("k")), markdown-list-item(markdown-list-item-text("X")))',
        },
        {
            name:   'X5: Backspace over an item between two paragraphs',
            source: 'a\n\n- w0\n\n  p1\n\nz',
            steps:  [{ key: 'Backspace', at: ['w0', 0], to: ['p1', 2] }, { key: 'type', text: 'X' }],
            saved:  'a\n\n- X\n\nz',
        },
        {
            name:   'X4b: Backspace over the first item of two leaves it empty',
            source: '- w0\n\n  p1\n- z',
            steps:  [{ key: 'Backspace', at: ['w0', 0], to: ['p1', 2] }],
            saved:  '-\n\n- z',
            shape:  'list(markdown-list-item(markdown-list-item-text()), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'X6: an image over the last item of two goes into an item of its own',
            source: '- k\n- w2\n\n  p3',
            steps:  [{ key: 'command', run: (editor) => editor.insertImage('u.png'), at: ['w2', 0], to: ['p3', 2] }],
            saved:  '- k\n\n- ![](u.png)',
        },
        {
            name:   'X7: an image over the only item goes into that item, as text typed over it does (X3)',
            source: '- w0\n\n  p1',
            steps:  [{ key: 'command', run: (editor) => editor.insertImage('u.png'), at: ['w0', 0], to: ['p1', 2] }],
            saved:  '- ![](u.png)',
        },
        {
            name:   'X8: a list of text items, all of it deleted, keeps an empty item (control)',
            source: '- w0\n- p1',
            steps:  [{ key: 'Backspace', at: ['w0', 0], to: ['p1', 2] }],
            saved:  '-',
            shape:  'list(markdown-list-item(markdown-list-item-text()))',
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

// A list item is a node of the editor's own (plans/markdown-editor-list-item-node.md): it holds blocks only, its text
// a block among them, and a nested list a block of its item. The rows below are the keys and commands in an item
// that no row above reaches: joins at and inside an item, Enter in each of an item's blocks, an indent and an
// outdent of an item holding a nested list, and a block type or list toggle at each kind of block.
describe('a join that takes an item between two nested lists away keeps the blocks after the second list', () => {
    const TWO_NESTED = '- a\n  - x\n- mid\n  - y\n\n  after\n- z';

    it.each<Row>([
        {
            name:   'A1: Backspace at the start of the item between them',
            source: TWO_NESTED,
            steps:  [{ key: 'Backspace', at: ['mid', 0] }],
            saved:  '- a\n  - xmid\n  - y\n\n  after\n\n- z',
            shape:  'list(markdown-list-item(markdown-list-item-text("a"), list(markdown-list-item(markdown-list-item-text("xmid")), markdown-list-item(markdown-list-item-text("y"))), paragraph("after")), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'A2: Delete at the end of the nested item before it',
            source: TWO_NESTED,
            steps:  [{ key: 'Delete', at: ['x', 1] }],
            saved:  '- a\n  - xmid\n  - y\n\n  after\n\n- z',
        },
        {
            name:   'A3: a range from the first nested list over an item to the text of the item holding the second',
            source: '- a\n  - x\n- mid\n- b\n  - y\n\n  after\n- z',
            steps:  [{ key: 'Backspace', at: ['x', 1], to: ['b', 0] }],
            saved:  '- a\n  - xb\n  - y\n\n  after\n\n- z',
        },
        {
            // Two items that each open with a nested list are two items: joining the item between them away merges neither.
            name:   'A4: Backspace at the start of an item between two items that open with a nested list',
            source: '- - a\n- x\n- - b\n\n  after\n- z',
            steps:  [{ key: 'Backspace', at: ['x', 0] }],
            saved:  '- - ax\n\n- - b\n\n  after\n\n- z',
        },
        {
            // The raw list of the item is edited into a list, which stands after the item's text as any nested list.
            name:               'B1: an item of a nested list that an edit built moves out, the outer item\'s text kept',
            source:             '- a\n\n  - x\n    > q\n- z',
            steps:              [{ key: 'Backspace', at: ['- x', 3], to: ['  > q', 5] }, { key: 'Backspace key', at: ['x', 0] }],
            saved:              '- a\n\n- x\n\n- z',
            comparesWithViewer: false,
        },
    ])('$name', runRow);
});

describe('a key in a list item acts on the block the caret is in', () => {
    /**
     * Puts the caret at the end of the document.
     *
     * @param editor - The editor.
     */
    const caretAtDocumentEnd = (editor: MarkdownEditor): void => {
        lexicalOf(editor).update(() => {
            $getRoot().selectEnd();
        }, { discrete: true });
    };

    it.each<Row>([
        {
            name:   'V1: Backspace at the start of an item\'s paragraph joins it to the item\'s text',
            source: '- a\n\n  p\n- z',
            steps:  [{ key: 'Backspace', at: ['p', 0] }],
            saved:  '- ap\n\n- z',
            shape:  'list(markdown-list-item(markdown-list-item-text("ap")), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'V2: Delete at the end of an item\'s text joins its paragraph to it',
            source: '- a\n\n  p\n- z',
            steps:  [{ key: 'Delete', at: ['a', 1] }],
            saved:  '- ap\n\n- z',
        },
        {
            name:   'V3: Enter in an item\'s paragraph splits the paragraph, both halves in the item',
            source: '- a\n\n  pq\n- z',
            steps:  [{ key: 'Enter', at: ['pq', 1] }],
            saved:  '- a\n\n  p\n\n  q\n\n- z',
        },
        {
            name:   'V4: Enter in a top-level item holding blank text alone ends the list there',
            source: '- a\n- z',
            steps:  [{ key: 'Enter', at: ['a', 1] }, { key: 'type', text: ' ' }, { key: 'Enter' }],
            saved:  '- a\n\n* z',
        },
        {
            name:   'V5: Enter in an empty nested item moves it out one level',
            source: '- a\n  - b\n- z',
            steps:  [{ key: 'Enter', at: ['b', 1] }, { key: 'Enter' }],
            saved:  '- a\n  - b\n-\n- z',
        },
        {
            name:   'V6: the Backspace key at the start of an item that opens with a heading takes the heading out of the list',
            source: 'p\n\n- # Foo\n- z',
            steps:  [{ key: 'Backspace key', at: ['Foo', 0] }],
            saved:  'p\n\n# Foo\n\n- z',
        },
        {
            name:   'V7: the Backspace key at the start of a top-level item takes its text and its blocks out of the list',
            source: '- a\n- b\n\n  c\n- z',
            steps:  [{ key: 'Backspace key', at: ['b', 0] }],
            saved:  '- a\n\nb\n\nc\n\n- z',
        },
        {
            name:   'V8: a join that takes a list\'s first item\'s text away takes its blocks up to its nested list out with it',
            source: 'p\n\n- a\n\n  b\n  - n\n\n  c\n- z',
            steps:  [{ key: 'Delete', at: ['p', 1] }],
            saved:  'pa\n\nb\n\n- - n\n\n  c\n\n- z',
        },
        {
            name:   'V9: Enter at the start of an item\'s text leaves an empty item before it',
            source: '- wx\n- z',
            steps:  [{ key: 'Enter', at: ['wx', 0] }],
            saved:  '-\n- wx\n- z',
        },
        {
            name:   'V10: Shift+Enter in an item\'s text breaks the line in the text',
            source: '- ab\n- z',
            steps:  [{ key: 'Shift+Enter', at: ['ab', 1] }],
            saved:  '- a\\\n  b\n- z',
        },
        {
            name:   'V11: Enter at the end of the text of an item holding a nested list gives the list to the new item, whose text is typed next',
            source: '- a\n  - n\n- z',
            steps:  [{ key: 'Enter', at: ['a', 1] }, { key: 'type', text: 'Q' }],
            saved:  '- a\n- Q\n  - n\n- z',
        },
        {
            name:   'V12: text typed in an empty item is the item\'s text',
            source: '-',
            steps:  [{ key: 'command', run: caretAtDocumentEnd }, { key: 'type', text: 'Q' }],
            saved:  '- Q',
        },
        {
            name:   'V13: Backspace at the start of a nested list under an emptied text removes the empty text alone',
            source: '- a\n  - n\n- z',
            steps:  [{ key: 'Backspace', at: ['a', 0], to: ['a', 1] }, { key: 'Backspace', at: ['n', 0] }],
            saved:  '- - n\n- z',
        },
        {
            name:   'V14: text typed after the text over a nested list is deleted is the item\'s text again',
            source: '- a\n  - n\n- z',
            steps:  [{ key: 'Backspace', at: ['a', 0], to: ['a', 1] }, { key: 'type', text: 'Q' }],
            saved:  '- Q\n  - n\n- z',
        },
        {
            name:   'V15: the same Backspace under an item that follows another keeps the nested list in its own item',
            source: '- k\n- a\n  - n\n- z',
            steps:  [{ key: 'Backspace', at: ['a', 0], to: ['a', 1] }, { key: 'Backspace', at: ['n', 0] }],
            saved:  '- k\n- - n\n- z',
        },
        {
            name:   'V16: the caret stays at the start of the text a top-level item is taken out of its list with',
            source: '- a\n- b\n\n  c\n- z',
            steps:  [{ key: 'Backspace key', at: ['b', 0] }, { key: 'type', text: 'X' }],
            saved:  '- a\n\nXb\n\nc\n\n- z',
        },
        {
            name:   'V17: the Backspace key in an empty top-level item leaves an empty paragraph holding the caret',
            source: '- a\n- z',
            steps:  [{ key: 'Enter', at: ['a', 1] }, { key: 'Backspace key' }, { key: 'type', text: 'X' }],
            saved:  '- a\n\nX\n\n- z',
        },
        {
            name:   'V18: a line break left last in an item\'s text by a deletion is dropped, as the save drops it',
            source: '- a\\\n  b\n- z',
            steps:  [{ key: 'Backspace', at: ['b', 0], to: ['b', 1] }],
            saved:  '- a\n- z',
            shape:  'list(markdown-list-item(markdown-list-item-text("a")), markdown-list-item(markdown-list-item-text("z")))',
        },
    ])('$name', runRow);
});

describe('an item that is indented or moved out keeps its own nested list under it', () => {
    it.each<Row>([
        {
            name:   'I1: indent of an item holding a nested list',
            source: '- a\n- b\n  - c\n- d',
            steps:  [{ key: 'indent', at: ['b', 1] }],
            saved:  '- a\n  - b\n    - c\n- d',
        },
        {
            name:   'I2: indent of a list\'s first item wraps it in an empty item',
            source: '- a\n- b',
            steps:  [{ key: 'indent', at: ['a', 1] }],
            saved:  '- - a\n- b',
        },
        {
            name:   'I3: outdent of a nested item holding a nested list: the list stays its own, the later items and blocks follow it',
            source: '- a\n  - b\n    - c\n  - d\n\n  e\n- f',
            steps:  [{ key: 'outdent', at: ['b', 1] }],
            saved:  '- a\n\n- b\n  - c\n  - d\n\n  e\n\n- f',
            shape:  'list(markdown-list-item(markdown-list-item-text("a")), markdown-list-item(markdown-list-item-text("b"), list(markdown-list-item(markdown-list-item-text("c")), markdown-list-item(markdown-list-item-text("d"))), paragraph("e")), markdown-list-item(markdown-list-item-text("f")))',
        },
        {
            name:   'I6: indent of an item after one that ends in a nested list of another marker joins that list',
            source: '- a\n  * n\n- b',
            steps:  [{ key: 'indent', at: ['b', 1] }],
            saved:  '- a\n  * n\n  * b',
        },
        {
            name:   'I4: indent over a range of two items moves each one level',
            source: '- a\n- b\n- c',
            steps:  [{ key: 'indent', at: ['b', 0], to: ['c', 1] }],
            saved:  '- a\n  - b\n  - c',
        },
        {
            name:   'I5: outdent over a range of two nested items moves each one level',
            source: '- a\n  - b\n  - c\n- d',
            steps:  [{ key: 'outdent', at: ['b', 0], to: ['c', 1] }],
            saved:  '- a\n- b\n- c\n- d',
        },
    ])('$name', runRow);
});

describe('a block type or a list toggle in a list item acts on the block the caret is in', () => {
    it.each<Row>([
        {
            name:   'H1: a heading set on an item\'s paragraph changes the paragraph in place',
            source: '- a\n\n  p\n- z',
            steps:  [{ key: 'command', run: (editor) => editor.setBlockType('h2'), at: ['p', 1] }],
            saved:  '- a\n\n  ## p\n\n- z',
        },
        {
            name:   'H2: the list toggled off on the text of an item holding a nested list leaves the nested list in an item',
            source: '- one\n  - inner\n- three',
            steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['one', 1] }],
            saved:  'one\n\n- - inner\n- three',
        },
        {
            name:   'H3: the list toggled off on the text of an item holding a paragraph takes both out of the list',
            source: '- one\n\n  second\n\n- two',
            steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['one', 1] }],
            saved:  'one\n\nsecond\n\n- two',
        },
        {
            name:   'H4: the list toggled on an item\'s paragraph, in a list of that kind, changes nothing',
            source: '- one\n\n  second\n\n- two',
            steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['second', 1] }],
            saved:  '- one\n\n  second\n\n- two',
        },
        {
            name:   'H5: the other list kind toggled in an empty item converts the item\'s list',
            source: '- a\n-\n- z',
            steps:  [{ key: 'Enter', at: ['a', 1] }, { key: 'command', run: (editor) => editor.toggleOrderedList() }],
            saved:  '1. a\n2.\n3.\n4. z',
        },
        {
            name:   'H6: the other list kind toggled in an item\'s text converts the item\'s list',
            source: '- a\n- b',
            steps:  [{ key: 'command', run: (editor) => editor.toggleOrderedList(), at: ['b', 1] }],
            saved:  '1. a\n2. b',
        },
        {
            name:   'H7: a heading set in an empty item takes the item out of its list, the caret in the heading',
            source: '- a\n- z',
            steps:  [{ key: 'Enter', at: ['a', 1] }, { key: 'command', run: (editor) => editor.setBlockType('h2') }, { key: 'type', text: 'X' }],
            saved:  '- a\n\n## X\n\n- z',
        },
        {
            name:   'H8: a list made of an empty paragraph has an item whose text takes what is typed',
            source: 'p',
            steps:  [
                { key: 'Enter', at: ['p', 1] }, { key: 'command', run: (editor) => editor.toggleUnorderedList() }, { key: 'type', text: 'X' },
            ],
            saved:  'p\n\n- X',
            shape:  'paragraph("p") | list(markdown-list-item(markdown-list-item-text("X")))',
        },
    ])('$name', runRow);
});

describe('a list whose every item a removal takes is left with an empty item holding the caret, or goes', () => {
    /**
     * Selects from a point between the root's blocks to the end of a text node: a range only a selection made in
     * code holds, and the one that takes every item of a list with it.
     *
     * @param editor - The editor.
     * @param rootOffset - The offset on the root the range starts at.
     * @param end - The text the range ends after.
     */
    const selectFromRoot = (editor: MarkdownEditor, rootOffset: number, end: string): void => {
        lexicalOf(editor).update(() => {
            const selection = $createRangeSelection();
            const text = $textNode(end);

            selection.anchor.set('root', rootOffset, 'element');
            selection.focus.set(text.getKey(), text.getTextContentSize(), 'text');
            $setSelection(selection);
        }, { discrete: true });
    };

    it.each<Row>([
        {
            name:   'X10: a list that is the whole document keeps an empty item, which takes what is typed',
            source: '- a\n- b',
            steps:  [{ key: 'command', run: (editor) => selectFromRoot(editor, 0, 'b') }, { key: 'Backspace' }, { key: 'type', text: 'X' }],
            saved:  '- X',
            shape:  'list(markdown-list-item(markdown-list-item-text("X")))',
        },
        {
            name:   'X11: a list after a paragraph goes with its items',
            source: 'p\n\n- a\n- b',
            steps:  [{ key: 'command', run: (editor) => selectFromRoot(editor, 1, 'b') }, { key: 'Backspace' }],
            saved:  'p',
            shape:  'paragraph("p")',
        },
    ])('$name', runRow);

    it('X12: an image over a whole item, from a point on the list before it, goes into an empty item put there', () => {
        const editor = load('- k\n- w0\n\n  p1\n- z');

        lexicalOf(editor).update(() => {
            const selection = $createRangeSelection();
            const end = $textNode('p1');

            selection.anchor.set($getRoot().getFirstChildOrThrow().getKey(), 1, 'element');
            selection.focus.set(end.getKey(), end.getTextContentSize(), 'text');
            $setSelection(selection);
        }, { discrete: true });
        editor.insertImage('u.png');

        expect(expectSaveKeepsDocument(editor, 'the image')).toBe('- k\n\n- ![](u.png)\n\n- z');
    });
});

describe('an ordered list numbers each of its items', () => {
    it('an item holding a nested list takes one number, and so does an item that opens with one', () => {
        const editor = load('3. a\n   1. n\n4. 1. m\n5. c');
        const values = lexicalOf(editor).read(() => $getRoot().getFirstChildOrThrow<ElementNode>().getChildren()
            .map((item) => (item as unknown as { getValue: () => number }).getValue()));

        expect(values).toEqual([3, 4, 5]);
        expect(editor.getValue()).toBe('3. a\n   1. n\n4. 1. m\n5. c');
    });
});

describe('an edit in a list item never leaves the caret, or what is typed, where no save writes it (Z rows)', () => {
    const TABLE_ITEM = '| t |\n  | --- |\n  | c |';

    /**
     * Puts the caret between the blocks of the list item whose text is `text`: an element point on the item,
     * where Lexical leaves a caret at the edge of a table the item holds.
     *
     * @param text - The item's text.
     * @param offset - The index of the block the caret stands before.
     * @returns A step's command.
     */
    const caretOnItem = (text: string, offset: number) => (editor: MarkdownEditor): void => {
        lexicalOf(editor).update(() => {
            const item = $textNode(text).getParentOrThrow().getParentOrThrow();
            const selection = $createRangeSelection();

            selection.anchor.set(item.getKey(), offset, 'element');
            selection.focus.set(item.getKey(), offset, 'element');
            $setSelection(selection);
        }, { discrete: true });
    };

    /**
     * Selects a range that starts between the blocks of the list item whose text is `text`.
     *
     * @param text - The item's text.
     * @param from - The index of the block the range starts before.
     * @param to - Where it ends: the index of a block of the same item, or a point in a text.
     * @returns A step's command.
     */
    const rangeOnItem = (text: string, from: number, to: number | TextPoint) => (editor: MarkdownEditor): void => {
        lexicalOf(editor).update(() => {
            const item = $textNode(text).getParentOrThrow().getParentOrThrow();
            const selection = $createRangeSelection();

            selection.anchor.set(item.getKey(), from, 'element');

            if (typeof to === 'number') {
                selection.focus.set(item.getKey(), to, 'element');
            } else {
                selection.focus.set($textNode(to[0]).getKey(), to[1], 'text');
            }

            $setSelection(selection);
        }, { discrete: true });
    };

    /**
     * Puts the caret on the document's first list, between two of its items.
     *
     * @param offset - The index of the item the caret stands before.
     * @returns A step's command.
     */
    const caretOnList = (offset: number) => (editor: MarkdownEditor): void => {
        lexicalOf(editor).update(() => {
            const list = $getRoot().getFirstChildOrThrow();
            const selection = $createRangeSelection();

            selection.anchor.set(list.getKey(), offset, 'element');
            selection.focus.set(list.getKey(), offset, 'element');
            $setSelection(selection);
        }, { discrete: true });
    };

    /**
     * Puts the caret before the table that opens the document's second item.
     *
     * @param editor - The editor.
     */
    const caretBeforeTableItem = (editor: MarkdownEditor): void => {
        lexicalOf(editor).update(() => {
            const item = $getRoot().getFirstChildOrThrow<ElementNode>().getChildAtIndex(1)!;
            const selection = $createRangeSelection();

            selection.anchor.set(item.getKey(), 0, 'element');
            selection.focus.set(item.getKey(), 0, 'element');
            $setSelection(selection);
        }, { discrete: true });
    };

    it.each<Row>([
        {
            name:   'Z1: a table inserted in an item\'s text splits the item and the list there, the second half an item',
            source: '- a\n- bc\n- z',
            steps:  [{ key: 'command', run: (editor) => editor.insertTable(1, 1), at: ['bc', 1] }],
            saved:  '- a\n- b\n\n|  |\n| --- |\n\n- c\n- z',
        },
        {
            name:   'Z2: the same in an item holding blocks: they stay with the text they followed',
            source: '- a\n- bc\n\n  pq\n  - n\n\n  e\n- z',
            steps:  [{ key: 'command', run: (editor) => editor.insertTable(1, 1), at: ['bc', 1] }],
            saved:  '- a\n\n- b\n\n|  |\n| --- |\n\n- c\n\n  pq\n\n  - n\n\n  e\n\n- z',
        },
        {
            name:   'Z3: Enter at the end of a text over a fence, then typing: the new item\'s text takes it',
            source: '- a\n- bc\n\n  ::: {align=center}\n  f\n  :::\n- z',
            steps:  [{ key: 'Enter', at: ['bc', 2] }, { key: 'type', text: 'QQ' }],
            saved:  '- a\n\n- bc\n\n- QQ\n\n  ::: {align=center}\n  f\n  :::\n\n- z',
        },
        {
            name:   'Z4: all of a text over a heading deleted, then typing: the item\'s text, not the heading\'s',
            source: '- a\n- bc\n\n  ## hh\n- z',
            steps:  [{ key: 'Backspace', at: ['bc', 0], to: ['bc', 2] }, { key: 'type', text: 'Q' }],
            saved:  '- a\n\n- Q\n\n  ## hh\n\n- z',
        },
        {
            name:   'Z5: the same over a table',
            source: `- a\n- bc\n\n  ${TABLE_ITEM}\n- z`,
            steps:  [{ key: 'Backspace', at: ['bc', 0], to: ['bc', 2] }, { key: 'type', text: 'Q' }],
            saved:  `- a\n\n- Q\n\n  ${TABLE_ITEM}\n\n- z`,
        },
        {
            name:   'Z6: the same over a raw block',
            source: '- a\n- bc\n\n  <div>\n- z',
            steps:  [{ key: 'Backspace', at: ['bc', 0], to: ['bc', 2] }, { key: 'type', text: 'Q' }],
            saved:  '- a\n\n- Q\n\n  <div>\n\n- z',
        },
        {
            name:   'Z7: an emptied text over a heading writes nothing: the item opens with the heading',
            source: '- a\n- bc\n\n  ## hh\n- z',
            steps:  [{ key: 'Backspace', at: ['bc', 0], to: ['bc', 2] }],
            saved:  '- a\n\n- ## hh\n\n- z',
            shape:  'list(markdown-list-item(markdown-list-item-text("a")), markdown-list-item(markdown-list-item-text(), heading("hh")), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'Z8: Enter in an emptied text over a table takes the item out of its list, the table with it',
            source: `- a\n- bc\n\n  ${TABLE_ITEM}\n- z`,
            steps:  [{ key: 'Enter', at: ['bc', 2] }, { key: 'Enter' }, { key: 'type', text: 'Q' }],
            saved:  '- a\n\n- bc\n\nQ\n\n| t |\n| --- |\n| c |\n\n- z',
        },
        {
            name:   'Z9: Enter in an emptied text over a nested list leaves an empty paragraph, the nested list in an item',
            source: '- a\n  - n\n- z',
            steps:  [{ key: 'Backspace', at: ['a', 0], to: ['a', 1] }, { key: 'Enter' }, { key: 'type', text: 'Q' }],
            saved:  'Q\n\n- - n\n- z',
        },
        {
            name:   'Z10: Enter over all of a text above a paragraph: the paragraph is the item\'s text and takes the caret',
            source: '- ab\n\n  p\n- z',
            steps:  [{ key: 'Enter', at: ['ab', 0], to: ['ab', 2] }, { key: 'type', text: 'Q' }],
            saved:  '- Qp\n\n- z',
        },
        {
            name:   'Z11: a table that is all an item holds, deleted: the item stays, empty, and takes what is typed',
            source: `- a\n- ${TABLE_ITEM}\n- z`,
            steps:  [{ key: 'command', run: (editor) => editor.deleteTable(), at: ['c', 0] }, { key: 'type', text: 'Q' }],
            saved:  '- a\n- Q\n- z',
        },
        {
            name:   'Z12: the same in a list\'s only item leaves the empty item',
            source: `- ${TABLE_ITEM}`,
            steps:  [{ key: 'command', run: (editor) => editor.deleteTable(), at: ['c', 0] }],
            saved:  '-',
            shape:  'list(markdown-list-item(markdown-list-item-text()))',
        },
        {
            name:   'Z13: the table\'s last column deleted leaves the empty item too',
            source: `- a\n- ${TABLE_ITEM}\n- z`,
            steps:  [{ key: 'command', run: (editor) => editor.deleteTableColumn(), at: ['c', 0] }, { key: 'type', text: 'Q' }],
            saved:  '- a\n- Q\n- z',
        },
        {
            name:   'Z14: a table deleted from an item holding more leaves the caret in a block of the item',
            source: `- a\n\n  ${TABLE_ITEM}\n- z`,
            steps:  [{ key: 'command', run: (editor) => editor.deleteTable(), at: ['c', 0] }, { key: 'type', text: 'Q' }],
            saved:  '- aQ\n\n- z',
        },
        {
            name:   'Z15: the Backspace key at the start of a paragraph after a list ending in a table joins nothing, the caret stays',
            source: `- a\n\n  ${TABLE_ITEM}\n\nb`,
            steps:  [{ key: 'Backspace key', at: ['b', 0] }, { key: 'type', text: 'Q' }],
            saved:  `- a\n\n  ${TABLE_ITEM}\n\nQb`,
        },
        {
            name:   'Z16: the same before a heading, which stays a heading',
            source: `- a\n\n  ${TABLE_ITEM}\n\n# b`,
            steps:  [{ key: 'Backspace key', at: ['b', 0] }, { key: 'type', text: 'Q' }],
            saved:  `- a\n\n  ${TABLE_ITEM}\n\n# Qb`,
        },
        {
            name:   'Z17: the same after a list whose nested last item ends in a table',
            source: '- a\n  - n\n\n    | t |\n    | --- |\n    | c |\n\nb',
            steps:  [{ key: 'Backspace key', at: ['b', 0] }, { key: 'type', text: 'Q' }],
            saved:  '- a\n  - n\n\n    | t |\n    | --- |\n    | c |\n\nQb',
        },
        {
            name:   'Z18: the same after a list ending in a fence',
            source: '- a\n\n  ::: {align=center}\n  f\n  :::\n\nb',
            steps:  [{ key: 'Backspace key', at: ['b', 0] }, { key: 'type', text: 'Q' }],
            saved:  '- a\n\n  ::: {align=center}\n  f\n  :::\n\nQb',
        },
        {
            name:   'Z19: Backspace at the start of an item after an item ending in a table joins nothing either',
            source: `- a\n\n  ${TABLE_ITEM}\n- b\n\n  r\n- z`,
            steps:  [{ key: 'Backspace', at: ['b', 0] }, { key: 'type', text: 'Q' }],
            saved:  `- a\n\n  ${TABLE_ITEM}\n\n- Qb\n\n  r\n\n- z`,
        },
        {
            name:   'Z20: a paragraph after a list ending in a paragraph still joins it (control)',
            source: '- a\n\n  p\n\nb',
            steps:  [{ key: 'Backspace key', at: ['b', 0] }],
            saved:  '- a\n\n  pb',
        },
        {
            name:   'Z21: Enter with the caret between the blocks of an item puts an empty paragraph there, which takes what is typed',
            source: `- a\n\n  ${TABLE_ITEM}\n- z`,
            steps:  [{ key: 'command', run: caretOnItem('a', 2) }, { key: 'Enter' }, { key: 'type', text: 'Q' }],
            saved:  `- a\n\n  ${TABLE_ITEM}\n\n  Q\n\n- z`,
        },
        {
            name:   'Z22: Shift+Enter there changes nothing: there is no line to break',
            source: `- a\n\n  ${TABLE_ITEM}\n- z`,
            steps:  [{ key: 'command', run: caretOnItem('a', 2) }, { key: 'Shift+Enter' }],
            saved:  `- a\n\n  ${TABLE_ITEM}\n- z`,
            shape:  'list(markdown-list-item(markdown-list-item-text("a"), table(tablerow(tablecell(paragraph("t"))), tablerow(tablecell(paragraph("c"))))), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'Z23: an image put there goes into a paragraph of its own in the item',
            source: `- a\n\n  ${TABLE_ITEM}\n- z`,
            steps:  [{ key: 'command', run: caretOnItem('a', 2) }, { key: 'command', run: (editor) => editor.insertImage('u.png') }],
            saved:  `- a\n\n  ${TABLE_ITEM}\n\n  ![](u.png)\n\n- z`,
        },
        {
            name:   'Z24: Enter with the caret before a table that opens an item gives the item a text, which takes what is typed',
            source: `- a\n- ${TABLE_ITEM}\n- z`,
            steps:  [{ key: 'command', run: caretBeforeTableItem }, { key: 'Enter' }, { key: 'type', text: 'Q' }],
            saved:  `- a\n\n- Q\n\n  ${TABLE_ITEM}\n\n- z`,
        },
        {
            name:   'Z25: a list made of paragraphs that hold links is tight',
            source: '[a](/a) and [b](/b)\n\n[c](/c) and [d](/d)',
            steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['a', 0], to: ['d', 1] }],
            saved:  '- [a](/a) and [b](/b)\n- [c](/c) and [d](/d)',
        },
        {
            name:   'Z26: the Backspace key at the start of the item an item holds alone (`- - n`) moves it out, and the outer item goes',
            source: '- - n\n- z',
            steps:  [{ key: 'Backspace key', at: ['n', 0] }],
            saved:  '- n\n- z',
        },
        {
            name:   'Z27: a block type set over a whole list of nested items leaves no empty item behind',
            source: '- a\n  - bc\n\n    pq\n  - y\n- z',
            steps:  [{ key: 'command', run: (editor) => editor.setBlockType('paragraph'), at: ['a', 0], to: ['z', 1] }],
            saved:  'a\n\nbc\n\npq\n\ny\n\nz',
        },
        {
            name:   'Z28: indent over an item and the item nested in it moves the outer one, the nested one with it',
            source: '- a\n- bc\n  - n\n- z',
            steps:  [{ key: 'indent', at: ['bc', 0], to: ['n', 1] }],
            saved:  '- a\n  - bc\n    - n\n- z',
        },
        {
            name:   'Z29: outdent over a nested item and the item nested in it likewise',
            source: '- a\n  - b\n    - n\n- z',
            steps:  [{ key: 'outdent', at: ['b', 0], to: ['n', 1] }],
            saved:  '- a\n- b\n  - n\n- z',
        },
        {
            name:   'Z30: outdent over a top-level item and the item nested in it moves the nested one: the outer one cannot move',
            source: '- a\n  - n\n- z',
            steps:  [{ key: 'outdent', at: ['a', 0], to: ['n', 1] }],
            saved:  '- a\n- n\n- z',
        },
        {
            name:   'Z32: indent over an item and a nested item that opens with a heading moves the nested one once too',
            source: '- k\n- a\n  - # h\n- z',
            steps:  [{ key: 'indent', at: ['a', 0], to: ['h', 1] }],
            saved:  '- k\n  - a\n    - # h\n- z',
        },
        {
            name:   'Z33: outdent over a nested item and the item nested in it that opens with a heading likewise',
            source: '- k\n  - a\n    - # h\n- z',
            steps:  [{ key: 'outdent', at: ['a', 0], to: ['h', 1] }],
            saved:  '- k\n- a\n  - # h\n- z',
        },
        {
            name:   'Z34: a line deleted backward at the start of a paragraph after a list ending in a table joins nothing either',
            source: `- a\n\n  ${TABLE_ITEM}\n\nb`,
            steps:  [
                { key: 'command', run: (editor) => { lexicalOf(editor).dispatchCommand(DELETE_LINE_COMMAND, true); }, at: ['b', 0] },
                { key: 'type', text: 'Q' },
            ],
            saved:  `- a\n\n  ${TABLE_ITEM}\n\nQb`,
        },
        {
            name:   'Z35: Shift+Enter with the caret on a list, between two items, changes nothing',
            source: '- a\n- z',
            steps:  [{ key: 'command', run: caretOnList(1) }, { key: 'Shift+Enter' }],
            saved:  '- a\n- z',
            shape:  'list(markdown-list-item(markdown-list-item-text("a")), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'Z36: an image put there goes into an item of its own',
            source: '- a\n- z',
            steps:  [{ key: 'command', run: caretOnList(1) }, { key: 'command', run: (editor) => editor.insertImage('u.png') }],
            saved:  '- a\n- ![](u.png)\n- z',
        },
        {
            name:   'Z37: Enter there puts an empty item there, which takes what is typed',
            source: '- a\n- z',
            steps:  [{ key: 'command', run: caretOnList(1) }, { key: 'Enter' }, { key: 'type', text: 'Q' }],
            saved:  '- a\n- Q\n- z',
        },
        {
            name:   'Z38: the Backspace key at the start of a paragraph of an item, after a fence of that item, joins nothing',
            source: '- a\n\n  ::: {align=center}\n  f\n  :::\n\n  p\n- z',
            steps:  [{ key: 'Backspace key', at: ['p', 0] }, { key: 'type', text: 'Q' }],
            saved:  '- a\n\n  ::: {align=center}\n  f\n  :::\n\n  Qp\n\n- z',
        },
        {
            name:   'Z39: the same after a fence outside any list',
            source: '::: {align=center}\nf\n:::\n\nb',
            steps:  [{ key: 'Backspace key', at: ['b', 0] }, { key: 'type', text: 'Q' }],
            saved:  '::: {align=center}\nf\n:::\n\nQb',
        },
        {
            name:   'Z40: Enter over a range between the blocks of an item puts an empty paragraph where the range was',
            source: `- a\n\n  ${TABLE_ITEM}\n- m\n- z\n\ntail`,
            steps:  [{ key: 'command', run: rangeOnItem('a', 1, 2) }, { key: 'Enter' }, { key: 'type', text: 'Q' }],
            saved:  '- a\n\n  Q\n\n- m\n\n- z\n\ntail',
        },
        {
            name:   'Z41: Shift+Enter over such a range changes nothing: nothing is removed for a break that is declined',
            source: `- a\n\n  ${TABLE_ITEM}\n- z`,
            steps:  [{ key: 'command', run: rangeOnItem('a', 1, 2) }, { key: 'Shift+Enter' }],
            saved:  `- a\n\n  ${TABLE_ITEM}\n- z`,
        },
        {
            name:   'Z42: Enter over a range from after an item\'s table into the next item\'s text',
            source: `- a\n\n  ${TABLE_ITEM}\n- m\n- z\n\ntail`,
            steps:  [{ key: 'command', run: rangeOnItem('a', 2, ['m', 1]) }, { key: 'Enter' }, { key: 'type', text: 'Q' }],
            saved:  `- a\n\n  ${TABLE_ITEM}\n\n  Q\n\n- z\n\ntail`,
        },
        {
            name:   'Z43: Enter over all of the text of an item of text alone leaves the emptied item and adds one, as in any list',
            source: '- a\n- bc\n- z',
            steps:  [{ key: 'Enter', at: ['bc', 0], to: ['bc', 2] }, { key: 'type', text: 'Q' }],
            saved:  '- a\n-\n- Q\n- z',
        },
        {
            name:   'Z44: Enter over the text of two such items likewise',
            source: '- a\n- bc\n- de\n- z',
            steps:  [{ key: 'Enter', at: ['bc', 0], to: ['de', 2] }],
            saved:  '- a\n-\n-\n- z',
        },
        {
            name:   'Z45: an empty paragraph after a list ending in a table is removed by the Backspace key, the caret at the end of the table\'s last cell',
            source: `- a\n\n  ${TABLE_ITEM}\n\nb`,
            steps:  [{ key: 'Backspace', at: ['b', 0], to: ['b', 1] }, { key: 'Backspace key' }, { key: 'type', text: 'Q' }],
            saved:  '- a\n\n  | t |\n  | --- |\n  | cQ |',
        },
        {
            name:   'Z46: an empty heading there likewise',
            source: `- a\n\n  ${TABLE_ITEM}\n\n# b`,
            steps:  [{ key: 'Backspace', at: ['b', 0], to: ['b', 1] }, { key: 'Backspace key' }, { key: 'type', text: 'Q' }],
            saved:  '- a\n\n  | t |\n  | --- |\n  | cQ |',
        },
        {
            name:   'Z47: an empty paragraph after a list whose nested last item ends in a table',
            source: '- a\n  - n\n\n    | t |\n    | --- |\n    | c |\n\nb',
            steps:  [{ key: 'Backspace', at: ['b', 0], to: ['b', 1] }, { key: 'Backspace key' }, { key: 'type', text: 'Q' }],
            saved:  '- a\n  - n\n\n    | t |\n    | --- |\n    | cQ |',
        },
        {
            name:   'Z48: an empty paragraph after a list ending in a fence: the caret goes to the end of the fence\'s last block',
            source: '- a\n\n  ::: {align=center}\n  f\n  :::\n\nb',
            steps:  [{ key: 'Backspace', at: ['b', 0], to: ['b', 1] }, { key: 'Backspace key' }, { key: 'type', text: 'Q' }],
            saved:  '- a\n\n  ::: {align=center}\n  fQ\n  :::',
        },
        {
            name:   'Z49: an empty item after an item ending in a table is removed by Backspace',
            source: `- a\n\n  ${TABLE_ITEM}\n- b\n- z`,
            steps:  [{ key: 'Backspace', at: ['b', 0], to: ['b', 1] }, { key: 'Backspace' }, { key: 'type', text: 'Q' }],
            saved:  '- a\n\n  | t |\n  | --- |\n  | cQ |\n\n- z',
        },
        {
            name:   'Z50: a line deleted backward in an empty paragraph after a list ending in a table removes the paragraph',
            source: `- a\n\n  ${TABLE_ITEM}\n\nb`,
            steps:  [
                { key: 'Backspace', at: ['b', 0], to: ['b', 1] },
                { key: 'command', run: (editor) => { lexicalOf(editor).dispatchCommand(DELETE_LINE_COMMAND, true); } },
                { key: 'type', text: 'Q' },
            ],
            saved:  '- a\n\n  | t |\n  | --- |\n  | cQ |',
        },
        {
            name:   'Z51: an empty paragraph of an item, after a fence of that item',
            source: '- a\n\n  ::: {align=center}\n  f\n  :::\n\n  p\n- z',
            steps:  [{ key: 'Backspace', at: ['p', 0], to: ['p', 1] }, { key: 'Backspace key' }, { key: 'type', text: 'Q' }],
            saved:  '- a\n\n  ::: {align=center}\n  fQ\n  :::\n\n- z',
        },
        {
            name:   'Z52: an empty paragraph after a fence outside any list',
            source: '::: {align=center}\nf\n:::\n\nb\n\ntail',
            steps:  [{ key: 'Backspace', at: ['b', 0], to: ['b', 1] }, { key: 'Backspace key' }, { key: 'type', text: 'Q' }],
            saved:  '::: {align=center}\nfQ\n:::\n\ntail',
        },
        {
            name:   'Z53: an empty paragraph after a table outside any list is removed the same way (the precedent, control)',
            source: '| t |\n| --- |\n| c |\n\nb\n\ntail',
            steps:  [{ key: 'Backspace', at: ['b', 0], to: ['b', 1] }, { key: 'Backspace key' }, { key: 'type', text: 'Q' }],
            saved:  '| t |\n| --- |\n| cQ |\n\ntail',
        },
        {
            name:   'Z54: a tab inserted with the caret between the blocks of an item goes into a paragraph of the item, as into any empty paragraph',
            source: `- a\n\n  ${TABLE_ITEM}\n- z`,
            steps:  [{ key: 'command', run: caretOnItem('a', 2) }, { key: 'command', run: (editor) => { lexicalOf(editor).dispatchCommand(INSERT_TAB_COMMAND, undefined); } }],
            shape:  'list(markdown-list-item(markdown-list-item-text("a"), table(tablerow(tablecell(paragraph("t"))), tablerow(tablecell(paragraph("c")))), paragraph("\\t")), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'Z55: the Backspace key with the caret before a table that opens an item takes the table out of the list, the caret still before it',
            source: `- a\n- ${TABLE_ITEM}\n- z`,
            steps:  [{ key: 'command', run: caretBeforeTableItem }, { key: 'Backspace key' }, { key: 'type', text: 'Q' }],
            saved:  '- a\n\nQ\n\n| t |\n| --- |\n| c |\n\n- z',
        },
        {
            name:   'Z56: the Backspace key in an emptied text over a heading moves the nested item out, as at the start of any item',
            source: '- a\n  - bc\n\n    ## hh\n- z',
            steps:  [{ key: 'Backspace', at: ['bc', 0], to: ['bc', 2] }, { key: 'Backspace key' }],
            saved:  '- a\n- ## hh\n- z',
        },
    ])('$name', runRow);

    it('Z31: text typed with the caret on a list, between two items, makes an item of its own', () => {
        const editor = load('- a\n- z');

        lexicalOf(editor).update(() => {
            const selection = $createRangeSelection();
            const list = $getRoot().getFirstChildOrThrow();

            selection.anchor.set(list.getKey(), 1, 'element');
            selection.focus.set(list.getKey(), 1, 'element');
            $setSelection(selection);
        }, { discrete: true });
        press(editor, { key: 'type', text: 'Q' });

        expect(expectSaveKeepsDocument(editor, 'the typing')).toBe('- a\n- Q\n- z');
    });
});
