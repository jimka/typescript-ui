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
    $getNodeByKey, INSERT_TAB_COMMAND, KEY_BACKSPACE_COMMAND, KEY_ENTER_COMMAND, OUTDENT_CONTENT_COMMAND, UNDO_COMMAND,
} from 'lexical';
import type { ElementNode, LexicalEditor, LexicalNode, PointType, RangeSelection, TextNode } from 'lexical';
import { $isListNode } from '@lexical/list';
import { $createQuoteNode, $isHeadingNode } from '@lexical/rich-text';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import type { MarkdownBlockType } from '~/component/editor/MarkdownEditor';
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
    const TABLE = '| h |\n| --- |\n| cell |';

    /**
     * Puts one end of the selection on a node that holds blocks, between its children: a point no click makes,
     * which a removed table leaves. The node is the one `levels` above the text node showing `text`
     * (2: its list item, 3: its list, and so on); the other end stays where it is unless `collapses`.
     *
     * @param text - The text.
     * @param levels - How many parents up.
     * @param offset - The child index the point stands before.
     * @param collapses - Whether the selection becomes a caret there, rather than a range ending there.
     * @returns A step's command.
     */
    const pointOnHolder = (text: string, levels: number, offset: number, collapses: boolean) => (editor: MarkdownEditor): void => {
        lexicalOf(editor).update(() => {
            let holder: LexicalNode = $textNode(text);

            for (let level = 0; level < levels; level++) {
                holder = holder.getParentOrThrow();
            }

            const selection = $getSelection() as RangeSelection;

            selection.focus.set(holder.getKey(), offset, 'element');

            if (collapses) {
                selection.anchor.set(holder.getKey(), offset, 'element');
            }
        }, { discrete: true });
    };

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
            name:   'H4: the list toggled on an item\'s paragraph, in a list of that kind, makes the paragraph an item of its own',
            source: '- one\n\n  second\n\n- two',
            steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['second', 1] }],
            saved:  '- one\n\n- second\n\n- two',
        },
        {
            name:   'H5: the other list kind toggled in an empty item changes that item alone, its list split around it',
            source: '- a\n-\n- z',
            steps:  [{ key: 'Enter', at: ['a', 1] }, { key: 'command', run: (editor) => editor.toggleOrderedList() }],
            saved:  '- a\n\n1.\n\n-\n- z',
        },
        {
            name:   'H6: the other list kind toggled in an item\'s text changes that item alone, its list split around it',
            source: '- a\n- b',
            steps:  [{ key: 'command', run: (editor) => editor.toggleOrderedList(), at: ['b', 1] }],
            saved:  '- a\n\n1. b',
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
        {
            name:   'H9: the other list kind toggled on the text of an item holding a paragraph changes the item\'s kind, the paragraph kept in it',
            source: '- one\n\n  second\n\n- two',
            steps:  [{ key: 'command', run: (editor) => editor.toggleOrderedList(), at: ['one', 1] }],
            saved:  '1. one\n\n   second\n\n- two',
            shape:  'list(markdown-list-item(markdown-list-item-text("one"), paragraph("second"))) | list(markdown-list-item(markdown-list-item-text("two")))',
        },
        {
            name:   'H10: the list toggled off takes a quote, a table, a ::: block and a raw block out with the item\'s text, each as it is',
            source: '- one\n\n  > q\n\n  | h |\n  | --- |\n  | c |\n\n  ::: {align=center}\n  f\n  :::\n\n  <div>x</div>\n\n- two',
            steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['one', 1] }],
            saved:  'one\n\n> q\n\n| h |\n| --- |\n| c |\n\n::: {align=center}\nf\n:::\n\n<div>x</div>\n\n- two',
            shape:  'paragraph("one") | quote("q") | table(tablerow(tablecell(paragraph("h"))), tablerow(tablecell(paragraph("c")))) | markdown-block(markdown-column(paragraph("f"))) | markdown-raw-block("<div>x</div>") | list(markdown-list-item(markdown-list-item-text("two")))',
        },
        {
            name:   'H11: the other list kind toggled there keeps all four in the item',
            source: '- one\n\n  > q\n\n  | h |\n  | --- |\n  | c |\n\n  ::: {align=center}\n  f\n  :::\n\n  <div>x</div>\n\n- two',
            steps:  [{ key: 'command', run: (editor) => editor.toggleOrderedList(), at: ['one', 1] }],
            saved:  '1. one\n\n   > q\n\n   | h |\n   | --- |\n   | c |\n\n   ::: {align=center}\n   f\n   :::\n\n   <div>x</div>\n\n- two',
            shape:  'list(markdown-list-item(markdown-list-item-text("one"), quote("q"), table(tablerow(tablecell(paragraph("h"))), tablerow(tablecell(paragraph("c")))), markdown-block(markdown-column(paragraph("f"))), markdown-raw-block("<div>x</div>"))) | list(markdown-list-item(markdown-list-item-text("two")))',
        },
        {
            name:   'H12: the blocks after the item\'s first nested list stay in the list, in an item with no text',
            source: '- one\n\n  second\n\n  - inner\n\n  after\n\n- two',
            steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['one', 1] }],
            saved:  'one\n\nsecond\n\n- - inner\n\n  after\n\n- two',
            shape:  'paragraph("one") | paragraph("second") | list(markdown-list-item(list(markdown-list-item(markdown-list-item-text("inner"))), paragraph("after")), markdown-list-item(markdown-list-item-text("two")))',
        },
        {
            name:   'H13: the list toggled on a later paragraph of an item gives the new item the blocks after it',
            source: '- one\n\n  second\n\n  third\n\n- two',
            steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['second', 1] }],
            saved:  '- one\n\n- second\n\n  third\n\n- two',
            shape:  'list(markdown-list-item(markdown-list-item-text("one")), markdown-list-item(markdown-list-item-text("second"), paragraph("third")), markdown-list-item(markdown-list-item-text("two")))',
        },
        {
            name:   'H14: the other list kind toggled there does the same in a list of its own',
            source: '- one\n\n  second\n\n  third\n\n- two',
            steps:  [{ key: 'command', run: (editor) => editor.toggleOrderedList(), at: ['second', 1] }],
            saved:  '- one\n\n1. second\n\n   third\n\n- two',
        },
        {
            name:   'H15: the list toggled off on the heading an item opens with takes the item out, the heading a paragraph',
            source: '- # Foo\n\n  para\n\n- bar',
            steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['Foo', 1] }],
            saved:  'Foo\n\npara\n\n- bar',
        },
        {
            name:   'H16: a nested item taken out leaves its own nested list one level up, beside the items that followed it',
            source: '- o\n  - x\n    - n\n  - y\n- z',
            steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['x', 1] }],
            saved:  '- o\n\nx\n\n- - n\n  - y\n- z',
            shape:  'list(markdown-list-item(markdown-list-item-text("o"))) | paragraph("x") | list(markdown-list-item(list(markdown-list-item(markdown-list-item-text("n")), markdown-list-item(markdown-list-item-text("y")))), markdown-list-item(markdown-list-item-text("z")))',
        },
        {
            name:   'H17: the caret stays in the text of an item that changes kind',
            source: '- one\n- two\n- three',
            steps:  [{ key: 'command', run: (editor) => editor.toggleOrderedList(), at: ['two', 1] }, { key: 'type', text: 'X' }],
            saved:  '- one\n\n1. tXwo\n\n- three',
        },
        {
            name:   'H18: a range over an item\'s text and its paragraph makes two items of the other kind',
            source: '- one\n\n  second\n\n- two',
            steps:  [{ key: 'command', run: (editor) => editor.toggleOrderedList(), at: ['one', 1], to: ['second', 1] }],
            saved:  '1. one\n2. second\n\n- two',
            shape:  'list(markdown-list-item(markdown-list-item-text("one")), markdown-list-item(markdown-list-item-text("second"))) | list(markdown-list-item(markdown-list-item-text("two")))',
        },
        {
            name:   'H19: the same toggle a second time takes the new item out of its list',
            source: '- one\n- two\n- three',
            steps:  [
                { key: 'command', run: (editor) => editor.toggleOrderedList(), at: ['two', 1] },
                { key: 'command', run: (editor) => editor.toggleOrderedList() },
            ],
            saved:  '- one\n\ntwo\n\n- three',
        },
        {
            name:   'H20: a new item made between a tight list and a loose one of its kind makes one loose list',
            source: '- a\n- b\n\nmid\n\n- c\n\n- d',
            steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['mid', 1] }],
            saved:  '- a\n\n- b\n\n- mid\n\n- c\n\n- d',
        },
        {
            name:   'H21: a new item made after a loose list of its kind leaves that list loose',
            source: '- one\n\n- two\n\nthree',
            steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['three', 1] }],
            saved:  '- one\n\n- two\n\n- three',
        },
        {
            name:   'H22: the list toggled in a ::: block of an item makes the list inside the block',
            source: '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two',
            steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['fenced', 1] }],
            saved:  '- one\n\n  ::: {align=center}\n  - fenced\n  :::\n\n- two',
            shape:  'list(markdown-list-item(markdown-list-item-text("one"), markdown-block(markdown-column(list(markdown-list-item(markdown-list-item-text("fenced")))))), markdown-list-item(markdown-list-item-text("two")))',
        },
        {
            name:   'H23: text typed after the other list kind is toggled in an empty item goes into the new item',
            source: '- a\n- z',
            steps:  [{ key: 'Enter', at: ['a', 1] }, { key: 'command', run: (editor) => editor.toggleOrderedList() }, { key: 'type', text: 'X' }],
            saved:  '- a\n\n1. X\n\n- z',
        },
        {
            name:   'H24: a code block made of a task item holds the marker as it was written',
            source: '- [ ] one\n- [x] two',
            steps:  [{ key: 'command', run: (editor) => editor.setBlockType('code'), at: ['one', 1] }],
            saved:  '```\n[ ] one\n```\n\n- [x] two',
        },
        {
            name:   'H25: after a table below a list is deleted the caret is on the list, and the other list kind changes the item before it',
            source: `- a\n- b\n\n${TABLE}`,
            steps:  [{ key: 'command', run: (editor) => editor.deleteTable(), at: ['cell', 1] }, { key: 'command', run: (editor) => editor.toggleOrderedList() }],
            saved:  '- a\n\n1. b',
        },
        {
            name:   'H26: the list toggled off there takes that item out',
            source: `- a\n- b\n\n${TABLE}`,
            steps:  [{ key: 'command', run: (editor) => editor.deleteTable(), at: ['cell', 1] }, { key: 'command', run: (editor) => editor.toggleUnorderedList() }],
            saved:  '- a\n\nb',
        },
        {
            name:   'H27: with the caret on a list whose last item ends in a paragraph, the toggle makes that paragraph an item',
            source: `- a\n\n  held\n\n${TABLE}`,
            steps:  [{ key: 'command', run: (editor) => editor.deleteTable(), at: ['cell', 1] }, { key: 'command', run: (editor) => editor.toggleUnorderedList() }],
            saved:  '- a\n\n- held',
        },
        {
            name:   'H28: with the caret on a ::: block, the toggle makes the last block of its last column an item, in the column',
            source: `::: columns\n- one\n- two\n|||\nRight\n:::\n\n${TABLE}`,
            steps:  [{ key: 'command', run: (editor) => editor.deleteTable(), at: ['cell', 1] }, { key: 'command', run: (editor) => editor.toggleUnorderedList() }],
            saved:  '::: columns\n- one\n- two\n|||\n- Right\n:::',
        },
        {
            name:   'H29: with the caret on a nested list, where a table its item held was deleted, the toggle takes the nested item out',
            source: '- a\n  - n\n\n  | h |\n  | --- |\n  | cell |\n\n- b',
            steps:  [{ key: 'command', run: (editor) => editor.deleteTable(), at: ['cell', 1] }, { key: 'command', run: (editor) => editor.toggleUnorderedList() }],
            saved:  '- a\n\nn\n\n- b',
        },
        {
            name:   'H30: the other list kind toggled there makes the nested item an item at the top level',
            source: '- a\n  - n\n\n  | h |\n  | --- |\n  | cell |\n\n- b',
            steps:  [{ key: 'command', run: (editor) => editor.deleteTable(), at: ['cell', 1] }, { key: 'command', run: (editor) => editor.toggleOrderedList() }],
            saved:  '- a\n\n1. n\n\n- b',
        },
        {
            name:   'H31: a caret on a list item, after its last block, is a caret in that block',
            source: '- a\n- b',
            steps:  [{ key: 'command', run: pointOnHolder('b', 2, 1, true), at: ['b', 1] }, { key: 'command', run: (editor) => editor.toggleUnorderedList() }],
            saved:  '- a\n\nb',
        },
        {
            name:   'H32: a range that ends on the root, between a list and the paragraph after it, ends in the list\'s last item',
            source: '- a\n- b\n\nlast',
            steps:  [{ key: 'command', run: pointOnHolder('a', 4, 1, false), at: ['a', 1] }, { key: 'command', run: (editor) => editor.toggleUnorderedList() }],
            saved:  'a\n\nb\n\nlast',
        },
        {
            name:   'H33: a range that ends on a list, before its first item, ends in the paragraph before the list',
            source: 'first\n\n- a\n- b',
            steps:  [{ key: 'command', run: pointOnHolder('a', 3, 0, false), at: ['first', 1] }, { key: 'command', run: (editor) => editor.toggleOrderedList() }],
            saved:  '1. first\n\n- a\n- b',
        },
        {
            name:   'H34: a caret on the root between a paragraph and a table goes into the paragraph, never into the table',
            source: `x\n\n${TABLE}\n\ny`,
            steps:  [{ key: 'command', run: pointOnHolder('x', 2, 1, true), at: ['x', 1] }, { key: 'command', run: (editor) => editor.toggleUnorderedList() }],
            saved:  `- x\n\n${TABLE}\n\ny`,
        },
        {
            name:   'H35: a caret on a list item between its text and a table it holds goes into the text',
            source: '- one\n\n  | h |\n  | --- |\n  | cell |\n\n- two',
            steps:  [{ key: 'command', run: pointOnHolder('one', 2, 1, true), at: ['one', 1] }, { key: 'command', run: (editor) => editor.toggleUnorderedList() }],
            saved:  `one\n\n${TABLE}\n\n- two`,
        },
        {
            name:   'H36: a caret with a table on both sides gets a new paragraph between them, which the toggle makes an item',
            source: `${TABLE}\n\n${TABLE}`,
            steps:  [{ key: 'command', run: pointOnHolder('cell', 5, 1, true), at: ['cell', 1] }, { key: 'command', run: (editor) => editor.toggleUnorderedList() }],
            saved:  `${TABLE}\n\n-\n\n${TABLE}`,
        },
        {
            name:   'H37: on a ::: block between two columns that hold a table alone, the paragraph goes before the table of the column after',
            source: `::: columns\n${TABLE}\n|||\n${TABLE}\n:::`,
            steps:  [{ key: 'command', run: pointOnHolder('cell', 6, 1, true), at: ['cell', 1] }, { key: 'command', run: (editor) => editor.toggleUnorderedList() }],
            saved:  `::: columns\n${TABLE}\n|||\n-\n\n${TABLE}\n:::`,
        },
        {
            name:   'H38: in a column a deleted table left empty, the toggle makes an item in the column, and typed text goes into it',
            source: `::: columns\n${TABLE}\n|||\nRight\n:::`,
            steps:  [
                { key: 'command', run: (editor) => editor.deleteTable(), at: ['cell', 1] },
                { key: 'command', run: (editor) => editor.toggleUnorderedList() },
                { key: 'type', text: 'Q' },
            ],
            saved:  '::: columns\n- Q\n|||\nRight\n:::',
        },
        {
            name:   'H39: in a centred block a deleted table left empty, the toggle makes the item inside the block',
            source: `::: {align=center}\n${TABLE}\n:::`,
            steps:  [{ key: 'command', run: (editor) => editor.deleteTable(), at: ['cell', 1] }, { key: 'command', run: (editor) => editor.toggleOrderedList() }],
            saved:  '::: {align=center}\n1.\n:::',
        },
        {
            name:   'H40: in a document a deleted table left empty, the toggle makes an item, and typed text goes into it',
            source: TABLE,
            steps:  [
                { key: 'command', run: (editor) => editor.deleteTable(), at: ['cell', 1] },
                { key: 'command', run: (editor) => editor.toggleUnorderedList() },
                { key: 'type', text: 'Q' },
            ],
            saved:  '- Q',
        },
        {
            name:   'H41: a caret on a table, between its rows, is left where it is, and the toggle changes nothing',
            source: `x\n\n${TABLE}`,
            steps:  [{ key: 'command', run: pointOnHolder('cell', 4, 1, true), at: ['cell', 1] }, { key: 'command', run: (editor) => editor.toggleUnorderedList() }],
            saved:  `x\n\n${TABLE}`,
            shape:  'paragraph("x") | table(tablerow(tablecell(paragraph("h"))), tablerow(tablecell(paragraph("cell"))))',
        },
    ])('$name', runRow);
});

describe('a block type or a list toggle acts on blocks of text, wherever the ends of the selection stand', () => {
    const TABLE = '| h |\n| --- |\n| cell |';
    const OTHER_TABLE = '| h |\n| --- |\n| zell |';
    const EMPTIED_CELL_TABLE = '| h |\n| --- |\n|  |';

    /** One end of a selection: a point in text, or a point on the node at `on` (child indexes from the root), before its child `offset`. */
    type End = TextPoint | { readonly on: readonly number[]; readonly offset: number };

    /**
     * Resolves one end of a selection.
     *
     * @param end - The end.
     * @returns The key, offset and type of its point.
     */
    const $pointOf = (end: End): [string, number, 'text' | 'element'] => {
        if ('on' in end) {
            const node = end.on.reduce<LexicalNode>((at, index) => (at as ElementNode).getChildAtIndex(index)!, $getRoot());

            return [node.getKey(), end.offset, 'element'];
        }

        return [$textNode(end[0]).getKey(), end[1], 'text'];
    };

    /**
     * Selects from one end to another, either of which can stand on a node that holds blocks: a point no click
     * makes, which a removed table leaves and code can set.
     *
     * @param anchor - The anchor.
     * @param focus - The focus; the anchor when omitted (a caret).
     * @returns A step's command.
     */
    const select = (anchor: End, focus: End = anchor) => (editor: MarkdownEditor): void => {
        lexicalOf(editor).update(() => {
            const selection = $createRangeSelection();

            selection.anchor.set(...$pointOf(anchor));
            selection.focus.set(...$pointOf(focus));
            $setSelection(selection);
        }, { discrete: true });
    };

    /**
     * Moves the focus alone, leaving the anchor where the step before left it.
     *
     * @param focus - The focus.
     * @returns A step's command.
     */
    const extendTo = (focus: End) => (editor: MarkdownEditor): void => {
        lexicalOf(editor).update(() => {
            ($getSelection() as RangeSelection).focus.set(...$pointOf(focus));
        }, { discrete: true });
    };

    const deleteTable: Step = { key: 'command', run: (editor) => editor.deleteTable(), at: ['cell', 1] };
    const bullets: Step = { key: 'command', run: (editor) => editor.toggleUnorderedList() };
    const numbers: Step = { key: 'command', run: (editor) => editor.toggleOrderedList() };
    const typed = (type: MarkdownBlockType): Step => ({ key: 'command', run: (editor) => editor.setBlockType(type) });

    it.each<Row>([
        {
            name:   'H42: a caret on a ::: block, before a column a deleted table left empty, goes into that column',
            source: `x\n\n::: columns\n${TABLE}\n|||\nRight\n:::\n\ny`,
            steps:  [deleteTable, { key: 'command', run: select({ on: [1], offset: 0 }) }, bullets, { key: 'type', text: 'Q' }],
            saved:  'x\n\n::: columns\n- Q\n|||\nRight\n:::\n\ny',
        },
        {
            name:   'H43: a caret on a ::: block, after its last column, which a deleted table left empty, goes into that column',
            source: `::: columns\nLeft\n|||\n${TABLE}\n:::\n\n- z`,
            steps:  [deleteTable, { key: 'command', run: select({ on: [0], offset: 2 }) }, numbers],
            saved:  '::: columns\nLeft\n|||\n1.\n:::\n\n- z',
        },
        {
            name:   'H44: a caret on the root, before a ::: block whose first column is empty, goes into that column',
            source: `x\n\n::: columns\n${TABLE}\n|||\nRight\n:::\n\ny`,
            steps:  [deleteTable, { key: 'command', run: select({ on: [], offset: 1 }) }, bullets],
            saved:  'x\n\n::: columns\n-\n|||\nRight\n:::\n\ny',
        },
        {
            name:   'H45: a caret between two empty columns goes into the one after it, and the other stays as it is',
            source: `::: columns\n${TABLE}\n|||\n${OTHER_TABLE}\n:::`,
            steps:  [deleteTable, { key: 'command', run: (editor) => editor.deleteTable(), at: ['zell', 1] }, { key: 'command', run: select({ on: [0], offset: 1 }) }, bullets],
            saved:  '::: columns\n\n|||\n-\n:::',
            shape:  'markdown-block(markdown-column(), markdown-column(list(markdown-list-item(markdown-list-item-text()))))',
        },
        {
            name:   'H46: a caret on a list item, after a centred block it holds that a deleted table left empty, goes into that block',
            source: '- one\n\n  ::: {align=center}\n  | h |\n  | --- |\n  | cell |\n  :::\n\n- two',
            steps:  [deleteTable, { key: 'command', run: select({ on: [0, 0], offset: 2 }) }, bullets],
            saved:  '- one\n\n  ::: {align=center}\n  -\n  :::\n\n- two',
        },
        {
            name:   'H47: a heading set where a deleted table left a column empty is made in the column, and typed text goes into it',
            source: `::: columns\n${TABLE}\n|||\nRight\n:::`,
            steps:  [deleteTable, typed('h2'), { key: 'type', text: 'Q' }],
            saved:  '::: columns\n## Q\n|||\nRight\n:::',
        },
        {
            name:   'H48: a code block set in a document a deleted table left empty is made there, and typed text goes into it',
            source: TABLE,
            steps:  [deleteTable, typed('code'), { key: 'type', text: 'Q' }],
            saved:  '```\nQ\n```',
        },
        {
            name:   'H49: a quote set with the caret on the root between two blocks changes the block after it',
            source: 'x\n\ny',
            steps:  [{ key: 'command', run: select({ on: [], offset: 1 }) }, typed('quote')],
            saved:  'x\n\n> y',
        },
        {
            name:   'H50: a code block set with the caret on a list, after its last item, changes that item, as it does from the item\'s text',
            source: 'first\n\n- a\n  - n\n- b',
            steps:  [{ key: 'command', run: select({ on: [1], offset: 2 }) }, typed('code')],
            saved:  'first\n\n- a\n  - n\n\n```\nb\n```',
        },
        {
            name:   'H51: a range over a column a deleted table left empty makes items of the blocks of text, and the column stays as it is',
            source: `x\n\n::: columns\n${TABLE}\n|||\nRight\n:::\n\ny`,
            steps:  [deleteTable, { key: 'command', run: select(['x', 0], ['y', 1]) }, bullets],
            saved:  '- x\n\n::: columns\n\n|||\n- Right\n:::\n\n- y',
            shape:  'list(markdown-list-item(markdown-list-item-text("x"))) | markdown-block(markdown-column(), '
                + 'markdown-column(list(markdown-list-item(markdown-list-item-text("Right"))))) | list(markdown-list-item(markdown-list-item-text("y")))',
        },
        {
            name:   'H52: the other list kind over that range does the same',
            source: `x\n\n::: columns\nLeft\n|||\n${TABLE}\n:::\n\ny`,
            steps:  [deleteTable, { key: 'command', run: select(['y', 1], ['x', 0]) }, numbers],
            saved:  '1. x\n\n::: columns\n1. Left\n|||\n\n:::\n\n1. y',
        },
        {
            name:   'H53: a heading set over that range changes the blocks of text alone',
            source: `x\n\n::: columns\n${TABLE}\n|||\nRight\n:::\n\ny`,
            steps:  [deleteTable, { key: 'command', run: select(['x', 0], ['y', 1]) }, typed('h2')],
            saved:  '## x\n\n::: columns\n\n|||\n## Right\n:::\n\n## y',
        },
        {
            name:   'H54: a code block set over that range does too',
            source: `x\n\n::: columns\n${TABLE}\n|||\nRight\n:::\n\ny`,
            steps:  [deleteTable, { key: 'command', run: select(['x', 0], ['y', 1]) }, typed('code')],
            saved:  '```\nx\n```\n\n::: columns\n\n|||\n```\nRight\n```\n:::\n\n```\ny\n```',
        },
        {
            name:   'H55: a range over a centred block a deleted table left empty leaves the block as it is',
            source: `x\n\n::: {align=center}\n${TABLE}\n:::\n\ny`,
            steps:  [deleteTable, { key: 'command', run: select(['x', 0], ['y', 1]) }, bullets],
            saved:  '- x\n\n::: {align=center}\n\n:::\n\n- y',
            shape:  'list(markdown-list-item(markdown-list-item-text("x"))) | markdown-block(markdown-column()) | list(markdown-list-item(markdown-list-item-text("y")))',
        },
        {
            name:   'H56: the list toggled off over two items, the first holding such a block, takes the block out with its item, as it is',
            source: '- one\n\n  ::: {align=center}\n  | h |\n  | --- |\n  | cell |\n  :::\n\n- two',
            steps:  [deleteTable, { key: 'command', run: select(['one', 0], ['two', 1]) }, bullets],
            saved:  'one\n\n::: {align=center}\n\n:::\n\ntwo',
            shape:  'paragraph("one") | markdown-block(markdown-column()) | paragraph("two")',
        },
        {
            name:   'H57: a range that starts on the empty column, where the deleted table left the caret, takes the column\'s new paragraph',
            source: `x\n\n::: columns\n${TABLE}\n|||\nRight\n:::\n\ny`,
            steps:  [deleteTable, { key: 'command', run: extendTo(['y', 1]) }, bullets],
            saved:  'x\n\n::: columns\n-\n|||\n- Right\n:::\n\n- y',
        },
        {
            name:   'H58: a range that ends on the empty column takes the column\'s new paragraph',
            source: `x\n\n::: columns\n${TABLE}\n|||\nRight\n:::\n\ny`,
            steps:  [deleteTable, { key: 'command', run: select(['x', 0], { on: [1, 0], offset: 0 }) }, typed('h2')],
            saved:  '## x\n\n::: columns\n##\n|||\nRight\n:::\n\ny',
        },
        {
            name:   'H59: a range over an item a deleted table left empty takes the item\'s empty text, as it takes an empty paragraph',
            source: '- a\n- | h |\n  | --- |\n  | cell |\n- z',
            steps:  [deleteTable, { key: 'command', run: select(['a', 0], ['z', 1]) }, numbers],
            saved:  '1. a\n2.\n3. z',
        },
        {
            name:   'H60: a heading set over that range makes the empty text a heading',
            source: '- a\n- | h |\n  | --- |\n  | cell |\n- z',
            steps:  [deleteTable, { key: 'command', run: select(['a', 0], ['z', 1]) }, typed('h2')],
            saved:  '## a\n\n##\n\n## z',
        },
        {
            name:   'H61: a range from a paragraph back to the end of the table before it changes the paragraph alone',
            source: `x\n\n${TABLE}\n\ny`,
            steps:  [{ key: 'command', run: select(['y', 1], { on: [1], offset: 2 }) }, bullets],
            saved:  `x\n\n${TABLE}\n\n- y`,
        },
        {
            name:   'H62: a range from a paragraph to the start of the table after it does too, the end standing on the table\'s first row',
            source: `x\n\n${TABLE}\n\ny`,
            steps:  [{ key: 'command', run: select(['x', 0], { on: [1, 0], offset: 0 }) }, numbers],
            saved:  `1. x\n\n${TABLE}\n\ny`,
        },
        {
            name:   'H63: a heading set over a range that starts at the end of a table changes the paragraph after the table',
            source: `x\n\n${TABLE}\n\ny`,
            steps:  [{ key: 'command', run: select({ on: [1, 1], offset: 1 }, ['y', 1]) }, typed('h2')],
            saved:  `x\n\n${TABLE}\n\n## y`,
        },
        {
            name:   'H64: a range between the end of one table and the start of the next takes the paragraph between them',
            source: `${TABLE}\n\nmid\n\n${OTHER_TABLE}`,
            steps:  [{ key: 'command', run: select({ on: [0], offset: 2 }, { on: [2], offset: 0 }) }, bullets],
            saved:  `${TABLE}\n\n- mid\n\n${OTHER_TABLE}`,
        },
        {
            name:   'H65: a range over a table with an empty cell changes nothing: it touches the table\'s cells',
            source: `x\n\n${EMPTIED_CELL_TABLE}\n\ny`,
            steps:  [{ key: 'command', run: select(['x', 0], ['y', 1]) }, bullets, typed('h2'), typed('code')],
            saved:  `x\n\n${EMPTIED_CELL_TABLE}\n\ny`,
        },
        {
            name:   'H66: a range from the end of an item, after its nested list, to the next item changes that item alone',
            source: '- a\n  - n\n- b',
            steps:  [{ key: 'command', run: select({ on: [0, 0], offset: 2 }, ['b', 1]) }, typed('h3')],
            saved:  '- a\n  - n\n\n### b',
        },
        {
            name:   'H67: the list toggled off over that range takes that item out, and leaves the nested item',
            source: '- a\n  - n\n- b',
            steps:  [{ key: 'command', run: select(['b', 1], { on: [0, 0], offset: 2 }) }, bullets],
            saved:  '- a\n  - n\n\nb',
        },
        {
            name:   'H68: a range that ends on the root, between two paragraphs, ends in the first',
            source: 'x\n\ny',
            steps:  [{ key: 'command', run: select(['x', 0], { on: [], offset: 1 }) }, typed('h2')],
            saved:  '## x\n\ny',
        },
        {
            name:   'H69: a range that starts there starts in the second',
            source: 'x\n\ny',
            steps:  [{ key: 'command', run: select({ on: [], offset: 1 }, ['y', 1]) }, numbers],
            saved:  'x\n\n1. y',
        },
        {
            name:   'H70: a range between two points with no block of text between them is a caret where it starts',
            source: 'x\n\n- a',
            steps:  [{ key: 'command', run: select({ on: [], offset: 1 }, { on: [1], offset: 0 }) }, bullets],
            saved:  'x\n\na',
        },
        {
            name:   'H71: a range from a holder before an empty column to one after it holds no block, and the caret goes into the column',
            source: `::: columns\n${TABLE}\n|||\nRight\n:::`,
            steps:  [deleteTable, { key: 'command', run: select({ on: [0], offset: 0 }, { on: [0], offset: 1 }) }, bullets],
            saved:  '::: columns\n-\n|||\nRight\n:::',
        },
        {
            name:   'H72: a range that starts on a holder before an empty column and ends in a text passes over the column',
            source: `x\n\n::: columns\n${TABLE}\n|||\nRight\n:::\n\ny`,
            steps:  [deleteTable, { key: 'command', run: select({ on: [], offset: 1 }, ['y', 1]) }, bullets],
            saved:  'x\n\n::: columns\n\n|||\n- Right\n:::\n\n- y',
        },
    ])('$name', runRow);

    it.each<{ name: string; source: string; anchor: End; focus?: End; available: boolean }>([
        { name: 'a caret on a table, between two rows', source: `x\n\n${TABLE}\n\ny`, anchor: { on: [1], offset: 1 }, available: false },
        { name: 'a caret on a row, after its cell', source: `x\n\n${TABLE}\n\ny`, anchor: { on: [1, 0], offset: 1 }, available: false },
        { name: 'a range from the end of one table to the start of the next, nothing between them', source: `${TABLE}\n\n${OTHER_TABLE}`, anchor: { on: [0], offset: 2 }, focus: { on: [1], offset: 0 }, available: false },
        { name: 'a range from the end of one table to the start of the next, a paragraph between them', source: `${TABLE}\n\nmid\n\n${OTHER_TABLE}`, anchor: { on: [0], offset: 2 }, focus: { on: [2], offset: 0 }, available: true },
        { name: 'a range from a paragraph to the start of the table after it', source: `x\n\n${TABLE}\n\ny`, anchor: ['x', 0], focus: { on: [1], offset: 0 }, available: true },
        { name: 'a range from a paragraph into the table after it', source: `x\n\n${TABLE}\n\ny`, anchor: ['x', 0], focus: { on: [1], offset: 1 }, available: false },
        { name: 'a caret on the root between two tables', source: `${TABLE}\n\n${OTHER_TABLE}`, anchor: { on: [], offset: 1 }, available: true },
    ])('canSetBlockType is $available for $name, and each command changes the document only where it is true', ({ source, anchor, focus, available }) => {
        const commands: ReadonlyArray<(editor: MarkdownEditor) => void> = [
            (editor) => editor.toggleUnorderedList(), (editor) => editor.toggleOrderedList(), (editor) => editor.setBlockType('h2'), (editor) => editor.setBlockType('code'),
        ];

        for (const command of commands) {
            const editor = load(source);

            select(anchor, focus)(editor);
            expect(editor.getSelectionState().canSetBlockType).toBe(available);
            command(editor);
            expect(editor.getValue() !== source).toBe(available);
            expectSaveKeepsDocument(editor, 'the command');
        }
    });

    it('adds no undo step for a block type every block of the range already has, over a column a deleted table left empty', () => {
        const editor = load(`x\n\n::: columns\n${TABLE}\n|||\nRight\n:::\n\ny`);

        press(editor, deleteTable);

        const emptied = shapeOf(editor);

        select(['x', 0], ['y', 1])(editor);
        editor.setBlockType('paragraph');
        expect(shapeOf(editor)).toBe(emptied);

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        expect(editor.getValue()).toBe(`x\n\n::: columns\n${TABLE}\n|||\nRight\n:::\n\ny`);
    });

    it('changes no block, and adds no undo step, when the caret settles into a block that is of the type already', () => {
        const editor = load('x\n\n```js\ncode\n```');

        press(editor, { key: 'type', text: 'A', at: ['x', 1] });
        select({ on: [], offset: 1 })(editor);
        editor.setBlockType('code');
        // The code block is not replaced by an equal one: it keeps its language.
        expect(editor.getValue()).toBe('xA\n\n```js\ncode\n```');
        expect(endsOnHolder(editor)).toBe(false);

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        expect(editor.getValue()).toBe('x\n\n```js\ncode\n```');
    });

    it('settles a caret on a table\'s holder beside the table, never in a cell', () => {
        const editor = load(`${TABLE}\n\n${OTHER_TABLE}`);

        select({ on: [], offset: 1 })(editor);
        editor.setBlockType('h2');
        expect(editor.getValue()).toBe(`${TABLE}\n\n##\n\n${OTHER_TABLE}`);
        press(editor, { key: 'type', text: 'Q' });
        expect(editor.getValue()).toBe(`${TABLE}\n\n## Q\n\n${OTHER_TABLE}`);
    });

    /** The nodes that hold blocks, by type name. */
    const HOLDERS: readonly string[] = ['root', 'markdown-block', 'markdown-column', 'list', 'markdown-list-item', 'table', 'tablerow', 'tablecell'];

    /**
     * Loads a sweep document: its source, after the table holding "cell" is deleted when it starts with `DEL:`, and
     * the one holding "zell" too when it starts with `DEL2:`.
     *
     * @param source - The source, with its prefix.
     * @returns The editor.
     */
    const loadEmptied = (source: string): MarkdownEditor => {
        const prefix = /^DEL2?:/.exec(source)?.[0] ?? '';
        const editor = load(source.slice(prefix.length));

        if (prefix !== '') {
            press(editor, deleteTable);
        }

        if (prefix === 'DEL2:') {
            press(editor, { key: 'command', run: (target) => target.deleteTable(), at: ['zell', 1] });
        }

        return editor;
    };

    /**
     * Every point on a node that holds blocks, and one point in each block of text, of a document.
     *
     * @param editor - The editor.
     * @returns The points on holders, and the points in text.
     */
    const endsOf = (editor: MarkdownEditor): { holders: End[]; texts: End[] } => lexicalOf(editor).read(() => {
        const pathOf = (node: LexicalNode): number[] => node.getParents().length === 0 ? [] : [...pathOf(node.getParentOrThrow()), node.getIndexWithinParent()];
        const elements = [$getRoot(), ...$dfs($getRoot()).map(({ node }) => node).filter($isElementNode).filter((node) => !node.is($getRoot()))];
        const holders = elements.filter((node) => HOLDERS.includes(node.getType()))
            .flatMap((node) => Array.from({ length: node.getChildrenSize() + 1 }, (unused, offset): End => ({ on: pathOf(node), offset })));
        const texts = elements.filter((node) => !node.isInline() && !HOLDERS.includes(node.getType()))
            .map((node): End => ({ on: [...pathOf(node), 0].slice(0, -1), offset: 0 }));

        return { holders, texts };
    });

    /**
     * Whether an end of the selection stands on a node that holds blocks.
     *
     * @param editor - The editor.
     * @returns Whether one does.
     */
    const endsOnHolder = (editor: MarkdownEditor): boolean => lexicalOf(editor).read(() => {
        const selection = $getSelection() as RangeSelection;

        return [selection.anchor, selection.focus].some((point) => point.type === 'element' && HOLDERS.includes(point.getNode().getType()));
    });

    /**
     * The child indexes that lead from the root down to a node.
     *
     * @param node - The node.
     * @returns The indexes, outermost first.
     */
    const $pathOf = (node: LexicalNode): number[] => {
        const parent = node.getParent();

        return parent === null ? [] : [...$pathOf(parent), node.getIndexWithinParent()];
    };

    /**
     * Compares two places in document order, each a list of child indexes.
     *
     * @param a - One place.
     * @param b - The other.
     * @returns A negative number when `a` comes first, a positive one when `b` does.
     */
    const inOrder = (a: readonly number[], b: readonly number[]): number => {
        const differs = a.findIndex((index, depth) => index !== b[depth]);

        return differs === -1 ? a.length - b.length : a[differs]! - (b[differs] ?? -1);
    };

    /**
     * Where a selection point stands in document order. A point on an element stands between two of its children.
     *
     * @param point - The point.
     * @returns The place.
     */
    const $placeOf = (point: PointType): number[] => {
        const path = $pathOf(point.getNode());

        return point.type === 'element' ? [...path, point.offset - 0.5] : path;
    };

    /**
     * What a block of text is, as far as a command on another block must leave it: its type, a heading's level,
     * the kind of list it opens an item of, and its text.
     *
     * @param block - The block.
     * @returns The description.
     */
    const $describe = (block: ElementNode): string => {
        const list = block.getParent()?.getParent();
        const opens = block.getPreviousSibling() === null && $isListNode(list) ? list.getListType() : '';

        return [block.getType(), $isHeadingNode(block) ? block.getTag() : '', opens, block.getTextContent()].join('|');
    };

    /**
     * The blocks of text outside a range: each by its key, with what it is ({@link $describe}). A block is inside
     * when an end of the range stands in it or it lies between the two ends.
     *
     * @param editor - The editor.
     * @returns The blocks outside; `null` for a caret, and for a range that holds no block of text, which acts as one.
     */
    const blocksOutsideRange = (editor: MarkdownEditor): Map<string, string> | null => lexicalOf(editor).read(() => {
        const selection = $getSelection() as RangeSelection;
        const [start, end] = selection.isBackward() ? [selection.focus, selection.anchor] : [selection.anchor, selection.focus];
        const blocks = $dfs($getRoot()).map(({ node }) => node).filter($isElementNode)
            .filter((node) => !node.isInline() && !HOLDERS.includes(node.getType()));
        const holds = (block: ElementNode, point: PointType): boolean => block.is(point.getNode()) || block.isParentOf(point.getNode());
        const isOutside = (block: ElementNode): boolean => {
            const isBefore = !holds(block, start) && inOrder($pathOf(block), $placeOf(start)) < 0;
            const isAfter = !holds(block, end) && inOrder($pathOf(block), $placeOf(end)) > 0;

            return isBefore || isAfter;
        };
        const outside = blocks.filter(isOutside);
        const holdsBlock = outside.length < blocks.length;

        return selection.isCollapsed() || !holdsBlock ? null : new Map(outside.map((block) => [block.getKey(), $describe(block)]));
    });

    /**
     * The blocks among `outside` that are no longer what they were: gone, or of another type, level, list kind or text.
     *
     * @param editor - The editor.
     * @param outside - The blocks, as {@link blocksOutsideRange} gave them.
     * @returns What each changed block was.
     */
    const changedOutside = (editor: MarkdownEditor, outside: ReadonlyMap<string, string>): string[] => lexicalOf(editor).read(() => (
        [...outside].filter(([key, was]) => {
            const block = $getNodeByKey(key);
            const isSame = $isElementNode(block) && block.isAttached() && $describe(block) === was;

            return !isSame;
        }).map(([, was]) => was)
    ));

    const SWEEP_COMMANDS: ReadonlyArray<[string, (editor: MarkdownEditor) => void]> = [
        ['a bulleted list', (editor) => editor.toggleUnorderedList()],
        ['a numbered list', (editor) => editor.toggleOrderedList()],
        ['a heading', (editor) => editor.setBlockType('h3')],
        ['a code block', (editor) => editor.setBlockType('code')],
    ];

    // Vitest's default per-test timeout is 5s. A sweep loads some thousand editors, which takes about two seconds
    // for the largest document alone and several times that with the whole suite running beside it.
    const SWEEP_TIMEOUT_MS = 60_000;

    // None of these holds a level 3 heading or a code block, so a command that is available has a block to change.
    it.each([
        'x\n\ny',
        'first\n\n- a\n  - n\n- b\n\nlast',
        `x\n\n${TABLE}\n\ny`,
        `${TABLE}\n\n${OTHER_TABLE}`,
        '- one\n\n  | h |\n  | --- |\n  | cell |\n\n- two',
        `- ${TABLE.replace(/\n/g, '\n  ')}`,
        `::: columns\n${TABLE}\n|||\n${OTHER_TABLE}\n:::`,
        '::: columns\n- one\n- two\n|||\nRight\n:::\n\n> after',
        `DEL:x\n\n::: columns\n${TABLE}\n|||\nRight\n:::\n\ny`,
        `DEL:::: columns\nLeft\n|||\n${TABLE}\n:::\n\n- z`,
        `DEL:::: {align=center}\n${TABLE}\n:::`,
        `DEL:${TABLE}`,
        '- one\n\n  ::: {align=center}\n  | h |\n  | --- |\n  | cell |\n  :::\n\n- two'.replace(/^/, 'DEL:'),
        `DEL:- a\n- ${TABLE.replace(/\n/g, '\n  ')}\n- z`,
        `DEL2:x\n\n::: columns\n${TABLE}\n|||\n${OTHER_TABLE}\n:::\n\n1. y`,
        `DEL:::: columns\nA\n|||\n${TABLE}\n|||\nC\n:::`,
    ])('with an end on any node that holds blocks, a command changes the document exactly where canSetBlockType is true, and no block outside a range: %j', (source) => {
        const { holders, texts } = endsOf(loadEmptied(source));
        const carets = holders.map((holder): [End, End] => [holder, holder]);
        const ranges = holders.flatMap((holder) => texts.slice(0, 2).flatMap((text): Array<[End, End]> => [[text, holder], [holder, text]]));

        for (const [anchor, focus] of [...carets, ...ranges]) {
            for (const [name, command] of SWEEP_COMMANDS) {
                const editor = loadEmptied(source);
                // The save tells a bulleted item from a numbered one, the shape an empty column from one holding an empty paragraph.
                const before = [editor.getValue(), shapeOf(editor)];
                const context = `${name} from ${JSON.stringify(anchor)} to ${JSON.stringify(focus)}`;

                select(anchor, focus)(editor);

                const available = editor.getSelectionState().canSetBlockType;
                const outside = blocksOutsideRange(editor);

                command(editor);

                const after = [editor.getValue(), shapeOf(editor)];
                const changed = after[0] !== before[0] || after[1] !== before[1];

                expect(changed, `${context}: ${after[1]}`).toBe(available);

                if (available) {
                    expect(endsOnHolder(editor), `an end left on a node that holds blocks after ${context}`).toBe(false);
                    expect(outside === null ? [] : changedOutside(editor, outside), `a block outside the range changed after ${context}`).toEqual([]);
                    expectSaveKeepsDocument(editor, context);
                    lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
                    expect([editor.getValue(), shapeOf(editor)], `one undo step after ${context}`).toEqual(before);
                }
            }
        }
    }, SWEEP_TIMEOUT_MS);
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
