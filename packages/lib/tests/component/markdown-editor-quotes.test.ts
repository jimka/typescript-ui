// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// MarkdownEditor holds a quote as a node of its own that holds blocks
// (plans/markdown-editor-quote-node.md): what a load builds, what a save
// writes, and what each edit does in a quote. After every step the save loads
// as the document the editor shows, and the viewer reads it the same way.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createRangeSelection, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isTextNode, $setSelection,
    CONTROLLED_TEXT_INSERTION_COMMAND, DELETE_CHARACTER_COMMAND, INDENT_CONTENT_COMMAND, INSERT_LINE_BREAK_COMMAND,
    KEY_BACKSPACE_COMMAND, KEY_ENTER_COMMAND, OUTDENT_CONTENT_COMMAND, PASTE_COMMAND, UNDO_COMMAND,
} from 'lexical';
import type { ElementNode, LexicalEditor, LexicalNode, TextNode } from 'lexical';
import { $generateJSONFromSelectedNodes } from '@lexical/clipboard';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import type { MarkdownBlockType } from '~/component/editor/MarkdownEditor';
import { $isMarkdownRawBlockNode } from '~/component/editor/markdownSourceNodes';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { canonicalSave, editorDefinitions, viewerDefinitions } from './markdown-roundtrip/harness';
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
    | { readonly key: 'Enter' | 'Shift+Enter' | 'Backspace' | 'Delete' | 'indent' | 'outdent' | 'Backspace key' | 'undo'; readonly at?: TextPoint; readonly to?: TextPoint }
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
    pressOnce(editor, step);

    // A typed shortcut is applied in an update of its own, which the update that typed it starts when it commits.
    lexicalOf(editor).read(() => null);
    lexicalOf(editor).read(() => null);
}

/**
 * Makes one edit, without waiting for the updates it starts.
 *
 * @param editor - The editor.
 * @param step - The edit.
 */
function pressOnce(editor: MarkdownEditor, step: Step): void {
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
        case 'undo':
            lexical.dispatchCommand(UNDO_COMMAND, undefined);
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
const TEXT_ONLY_BLOCKS: readonly string[] = ['paragraph', 'markdown-list-item-text', 'heading', 'code', 'markdown-raw-block'];

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
 * The text point the caret stands at.
 *
 * @param editor - The editor.
 * @returns The exact text of the caret's text node and the offset in it.
 */
function caretOf(editor: MarkdownEditor): TextPoint {
    return lexicalOf(editor).read(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection) || selection.anchor.type !== 'text') {
            throw new Error('the caret is not in a text node');
        }

        return [selection.anchor.getNode().getTextContent(), selection.anchor.offset] as TextPoint;
    });
}

/**
 * A step that puts the caret in the document's first block, the empty paragraph of an empty quote included.
 *
 * @returns The step.
 */
function caretAtStart(): Step {
    return {
        key: 'command',
        run: (editor) => {
            lexicalOf(editor).update(() => {
                $getRoot().selectStart();
            }, { discrete: true });
        },
    };
}

/**
 * Asserts the editor's document is one its save keeps: loading the save shows
 * the same document, each raw block reading as it did (reload), saving that gives the same source
 * (idempotence), the viewer reads the save as the editor shows it (parity),
 * and the standard form of the document — what a save writes for it once it
 * is edited further — reads as the save does and loads as the same document
 * (canonical), and the editor reads the link reference definitions the viewer
 * reads off the save (definitions).
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

    const own = editorDefinitions(editor);

    expect(own, `definitions after ${context}: ${JSON.stringify(saved)}`).toEqual(viewerDefinitions(saved, own));

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
    /** The save after each step, where the row pins it (`undefined` for a step it leaves free). */
    readonly savedAfter?: readonly (string | undefined)[];
    /** The document's shape after each step, where the row pins it (`undefined` for a step it leaves free). */
    readonly shapeAfter?: readonly (string | undefined)[];
    /** The standard-form save ({@link canonicalSave}) after the last step, when the row pins it. */
    readonly standard?: string;
    /** The text of the block the caret stands at the very start of after the last step, as a point in its text or on the block itself. */
    readonly caretStartsBlock?: string;
    /** The text point the caret stands at after the last step, when the row pins it. */
    readonly caret?: TextPoint;
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

        const savedHere = row.savedAfter?.[index];
        const shapeHere = row.shapeAfter?.[index];

        if (savedHere !== undefined) {
            expect(editor.getValue(), `save after step ${index + 1}`).toBe(savedHere);
        }

        if (shapeHere !== undefined) {
            expect(shapeOf(editor), `shape after step ${index + 1}`).toBe(shapeHere);
        }
    });

    if (row.saved !== undefined) {
        expect(editor.getValue()).toBe(row.saved);
    }

    if (row.shape !== undefined) {
        expect(shapeOf(editor)).toBe(row.shape);
    }

    if (row.standard !== undefined) {
        expect(canonicalSave(editor)).toBe(row.standard);
    }

    if (row.caretStartsBlock !== undefined) {
        const startsBlock = lexicalOf(editor).read(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.offset !== 0) {
                return false;
            }

            const node = selection.anchor.getNode();
            const block = $isElementNode(node) ? node : node.getParent();

            return block !== null && block.getTextContent() === row.caretStartsBlock && !$isTextNode(block);
        });

        expect(startsBlock, 'the caret stands at the start of the block').toBe(true);
    }

    if (row.caret !== undefined) {
        expect(caretOf(editor)).toEqual(row.caret);
    }
}


/**
 * A step that types `text`.
 *
 * @param text - The text.
 * @param at - Where the caret is put first, if anywhere.
 * @param to - The other end of a range.
 * @returns The step.
 */
function typeText(text: string, at?: TextPoint, to?: TextPoint): Step {
    return { key: 'type', text, at, to };
}

/**
 * A step that calls one of the editor's own commands.
 *
 * @param run - The command.
 * @param at - Where the caret is put first, if anywhere.
 * @param to - The other end of a range.
 * @returns The step.
 */
function command(run: (editor: MarkdownEditor) => void, at?: TextPoint, to?: TextPoint): Step {
    return { key: 'command', run, at, to };
}

/**
 * A step that makes a block type or the quote command.
 *
 * @param type - The block type.
 * @param at - Where the caret is put first, if anywhere.
 * @param to - The other end of a range.
 * @returns The step.
 */
function blockType(type: MarkdownBlockType, at?: TextPoint, to?: TextPoint): Step {
    return command((editor) => { editor.setBlockType(type); }, at, to);
}

describe('a quote loads as the blocks it holds and saves as it was written', () => {
    it.each<Row>([
        {
            name:     'a quote of two paragraphs',
            source:   '> a\n>\n> b',
            steps:    [],
            shape:    'markdown-quote(paragraph("a"), paragraph("b"))',
            saved:    '> a\n>\n> b',
            standard: '> a\n>\n> b',
        },
        {
            name:     'a heading and a paragraph with a lazy line',
            source:   '> # Foo\n> bar\nbaz',
            steps:    [],
            shape:    'markdown-quote(heading("Foo"), paragraph("bar", " ", "baz"))',
            saved:    '> # Foo\n> bar\nbaz',
            standard: '> # Foo\n>\n> bar\n> baz',
        },
        {
            name:     'a list',
            source:   '> - one\n> - two',
            steps:    [],
            shape:    'markdown-quote(list(markdown-list-item(markdown-list-item-text("one")), markdown-list-item(markdown-list-item-text("two"))))',
            saved:    '> - one\n> - two',
            standard: '> - one\n> - two',
        },
        {
            name:     'three levels and a lazy line',
            source:   '> > > foo\nbar',
            steps:    [],
            shape:    'markdown-quote(markdown-quote(markdown-quote(paragraph("foo", " ", "bar"))))',
            saved:    '> > > foo\nbar',
            standard: '> > > foo\n> > > bar',
        },
        {
            name:     'a fence closed in a nested quote',
            source:   '> > ```\n> > a\n> > ```\nb',
            steps:    [],
            shape:    'markdown-quote(markdown-quote(code("a"))) | paragraph("b")',
            saved:    '> > ```\n> > a\n> > ```\nb',
            standard: '> > ```\n> > a\n> > ```\n\nb',
        },
        {
            name:     'an empty quote',
            source:   '>',
            steps:    [],
            shape:    'markdown-quote(paragraph())',
            saved:    '>',
            standard: '>',
        },
        {
            name:     'an HTML block',
            source:   '> <div>\n> x\n> </div>',
            steps:    [],
            shape:    'markdown-quote(markdown-raw-block("<div>", linebreak, "x", linebreak, "</div>"))',
            saved:    '> <div>\n> x\n> </div>',
            standard: '> <div>\n> x\n> </div>',
            comparesWithViewer: false,
        },
        {
            name:     'a repeated definition',
            source:   '[x]: /a\n\n> [x]: /b',
            steps:    [],
            shape:    'markdown-raw-block("[x]: /a") | markdown-quote(markdown-raw-block("[x]: /b"))',
            saved:    '[x]: /a\n\n> [x]: /b',
            comparesWithViewer: false,
        },
        {
            name:     'a quote in a list item',
            source:   '- a\n\n  > q\n  >\n  > r\n- z',
            steps:    [],
            shape:    'list(markdown-list-item(markdown-list-item-text("a"), markdown-quote(paragraph("q"), paragraph("r"))), markdown-list-item(markdown-list-item-text("z")))',
            saved:    '- a\n\n  > q\n  >\n  > r\n- z',
            standard: '- a\n\n  > q\n  >\n  > r\n\n- z',
        },
        {
            name:     'a tab after the marker',
            source:   '>\ta\n>\n>\tb',
            steps:    [],
            shape:    'markdown-quote(paragraph("a"), paragraph("b"))',
            saved:    '>\ta\n>\n>\tb',
        },
        {
            name:     'a lazy line starting an HTML block stays raw',
            source:   'p\n\n  > q\n  <div\n\nz',
            steps:    [],
            shape:    'paragraph("p") | markdown-raw-block("> q", linebreak, "  <div") | paragraph("z")',
            saved:    'p\n\n  > q\n  <div\n\nz',
            standard: 'p\n\n> q\n  <div\n\nz',
            comparesWithViewer: false,
        },
        {
            name:     'a lazy line in a quote\'s list stays raw',
            source:   '> - a\nb\n\nafter',
            steps:    [],
            shape:    'markdown-raw-block("> - a", linebreak, "b") | paragraph("after")',
            saved:    '> - a\nb\n\nafter',
            comparesWithViewer: false,
        },
        {
            name:     'a tight quote under an item\'s text stays a raw list',
            source:   '- a\n  > q\n- b',
            steps:    [],
            shape:    'markdown-raw-block("- a", linebreak, "  > q", linebreak, "- b")',
            saved:    '- a\n  > q\n- b',
            comparesWithViewer: false,
        },
    ])('$name', runRow);
});

describe('Enter, Backspace and Delete in a quote', () => {
    it.each<Row>([
        { name: 'Enter in the middle of a paragraph', source: '> ab', steps: [{ key: 'Enter', at: ['ab', 1] }], saved: '> a\n>\n> b' },
        {
            name: 'Enter twice at the end leaves the quote', source: '> a',
            steps: [{ key: 'Enter', at: ['a', 1] }, { key: 'Enter' }, typeText('Z')], saved: '> a\n\nZ',
        },
        {
            name: 'Enter twice in the middle splits the quote', source: '> a\n>\n> b',
            steps: [{ key: 'Enter', at: ['a', 1] }, { key: 'Enter' }, typeText('Z')], saved: '> a\n\nZ\n\n> b',
        },
        {
            name: 'Enter on a blank paragraph', source: '> a',
            steps: [{ key: 'Enter', at: ['a', 1] }, typeText('  '), { key: 'Enter' }], saved: '> a',
        },
        { name: 'Enter in an empty quote', source: '>', steps: [caretAtStart(), { key: 'Enter' }, typeText('Z')], saved: 'Z' },
        {
            name: 'Enter twice in a nested quote goes one level', source: '> > a',
            steps: [{ key: 'Enter', at: ['a', 1] }, { key: 'Enter' }, { key: 'Enter' }, typeText('Z')], saved: '> > a\n\nZ',
            shapeAfter: [undefined, 'markdown-quote(markdown-quote(paragraph("a")), paragraph())'],
        },
        {
            name: 'Enter in a quote\'s list', source: '> - a',
            steps: [{ key: 'Enter', at: ['a', 1] }, { key: 'Enter' }, { key: 'Enter' }], saved: '> - a',
            shapeAfter: [undefined, 'markdown-quote(list(markdown-list-item(markdown-list-item-text("a"))), paragraph())'],
        },
        { name: 'Shift+Enter', source: '> ab', steps: [{ key: 'Shift+Enter', at: ['ab', 1] }], saved: '> a\\\n> b' },
        {
            name: 'Enter in a quote\'s code', source: '> ```\n> x\n> ```',
            steps: [{ key: 'Enter', at: ['x', 1] }], saved: '> ```\n> x\n>\n> ```',
        },
        { name: 'Backspace key at the quote\'s start', source: '> a\n>\n> b', steps: [{ key: 'Backspace key', at: ['a', 0] }], saved: 'a\n\n> b' },
        { name: 'Backspace key at the start of a quote first in the document', source: '> a', steps: [{ key: 'Backspace key', at: ['a', 0] }], saved: 'a' },
        { name: 'Backspace key in an empty quote', source: '>\n\nx', steps: [caretAtStart(), { key: 'Backspace key' }], saved: 'x' },
        { name: 'Backspace key at a later block\'s start', source: '> a\n>\n> b', steps: [{ key: 'Backspace key', at: ['b', 0] }], saved: '> ab' },
        { name: 'Backspace key: the nearer container decides, a list item', source: '> - a', steps: [{ key: 'Backspace key', at: ['a', 0] }], saved: '> a' },
        { name: 'Backspace key: the nearer container decides, a quote', source: '- > a', steps: [{ key: 'Backspace key', at: ['a', 0] }], saved: '- a' },
        { name: 'Backspace joins into the block before', source: 'x\n\n> a', steps: [{ key: 'Backspace', at: ['a', 0] }], saved: 'xa' },
        { name: 'Backspace after a quote joins into it', source: '> a\n\ny', steps: [{ key: 'Backspace', at: ['y', 0] }], saved: '> ay' },
        { name: 'Delete at the end of a quote', source: '> a\n\nb', steps: [{ key: 'Delete', at: ['a', 1] }], saved: '> ab' },
        { name: 'Delete before a list', source: '> a\n\n- b', steps: [{ key: 'Delete', at: ['a', 1] }], saved: '> ab' },
        {
            name: 'Backspace in an empty block after the quote\'s last paragraph', source: '> a',
            steps: [{ key: 'Enter', at: ['a', 1] }, { key: 'Backspace key' }], saved: '> a', caret: ['a', 1],
        },
        {
            name: 'Backspace after a quote ending in a table', source: '> a\n>\n> | h |\n> | --- |\n> | c |\n\ny',
            steps: [{ key: 'Backspace', at: ['y', 0] }], saved: '> a\n>\n> | h |\n> | --- |\n> | c |\n\ny', caret: ['y', 0],
        },
        { name: 'typing over a range out of the quote', source: '> ab\n\ncd', steps: [typeText('Q', ['ab', 1], ['cd', 1])], saved: '> aQd' },
        { name: 'typing over a range from one quote into another', source: '> ab\n\n> cd', steps: [typeText('Q', ['ab', 1], ['cd', 1])], saved: '> aQd' },
        { name: 'typing over a range into a quote', source: 'ab\n\n> cd\n>\n> ef', steps: [typeText('Q', ['ab', 1], ['cd', 1])], saved: 'aQd\n\n> ef' },
        {
            name: 'undo of Enter leaving the quote', source: '> a',
            steps: [{ key: 'Enter', at: ['a', 1] }, { key: 'Enter' }, { key: 'undo' }], shape: 'markdown-quote(paragraph("a"), paragraph())',
        },
    ])('$name', runRow);
});

describe('Lexical\'s own split at a point on a quote keeps the quote\'s blocks in a quote', () => {
    /**
     * Splits `> a` / `>` / `> b` with `RangeSelection.insertParagraph` at an element point on the quote.
     *
     * @param offset - The point's offset in the quote.
     * @returns The editor.
     */
    function splitAt(offset: number): MarkdownEditor {
        const editor = load('> a\n>\n> b');

        lexicalOf(editor).update(() => {
            const quote = $getRoot().getFirstChildOrThrow<ElementNode>();

            quote.select(offset, offset);

            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                selection.insertParagraph();
            }
        }, { discrete: true });

        return editor;
    }

    it('in the middle the blocks after the point stay in a quote of their own', () => {
        const editor = splitAt(1);

        // Lexical adds empty paragraphs at the document's level after a split of a container; they save nothing.
        expect(shapeOf(editor)).toMatch(/^markdown-quote\(paragraph\("a"\)\) \| markdown-quote\(paragraph\("b"\)\)/);
        expectSaveKeepsDocument(editor, 'the split');
    });

    it.each([0, 2])('at offset %i no block leaves the quote and no empty quote is added', (offset) => {
        const editor = splitAt(offset);

        // Lexical splits the document there and adds two empty paragraphs after the quote, which save nothing.
        expect(shapeOf(editor)).toBe('markdown-quote(paragraph("a"), paragraph("b")) | paragraph() | paragraph()');
        expectSaveKeepsDocument(editor, 'the split');
    });
});

describe('a range that starts just before a quote is removed first, as for a list', () => {
    /**
     * Selects from the point on the document just before the quote to the end of the text `b`, then removes the range
     * (or not) and types `Z`.
     *
     * @param source - The document.
     * @param removesFirst - Whether Delete removes the range before the character is typed.
     * @returns The save.
     */
    function typedOverRange(source: string, removesFirst: boolean): string {
        const editor = load(source);

        lexicalOf(editor).update(() => {
            const selection = $createRangeSelection();
            const quote = $getRoot().getChildren().find((child) => child.getType() === 'markdown-quote')!;

            selection.anchor.set($getRoot().getKey(), quote.getIndexWithinParent(), 'element');
            selection.focus.set($textNode('b').getKey(), 1, 'text');
            $setSelection(selection);
        }, { discrete: true });

        if (removesFirst) {
            lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
        }

        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'Z');

        return editor.getValue();
    }

    it.each(['x\n\n> a\n>\n> b', '> a\n>\n> b\n\ny'])('typing over the range gives what Delete then typing gives: %j', (source) => {
        expect(typedOverRange(source, false)).toBe(typedOverRange(source, true));
    });
});

describe('a block type, a list toggle and a table act inside a quote', () => {
    it.each<Row>([
        {
            name: 'a heading in a quote', source: '> a\n>\n> b',
            steps: [blockType('h2', ['a', 1])], saved: '> ## a\n>\n> b',
        },
        {
            name: 'a heading in a quote, back to a paragraph', source: '> a\n>\n> b',
            steps: [blockType('h2', ['a', 1]), blockType('paragraph')], saved: '> a\n>\n> b',
        },
        {
            name: 'code in a quote', source: '> a\n>\n> b',
            steps: [blockType('code', ['a', 1])], saved: '> ```\n> a\n> ```\n>\n> b',
        },
        {
            name: 'code over a text that is escaped', source: '> \\- alpha',
            steps: [blockType('code', ['- alpha', 1])], saved: '> ```\n> \\- alpha\n> ```',
        },
        {
            name: 'a bulleted list toggled in a quote', source: '> a',
            steps: [command((editor) => { editor.toggleUnorderedList(); }, ['a', 1])], saved: '> - a',
        },
        {
            name: 'a numbered list toggled on a quote\'s paragraphs', source: '> a\n>\n> b',
            steps: [command((editor) => { editor.toggleOrderedList(); }, ['a', 0], ['b', 1])], saved: '> 1. a\n> 2. b',
        },
        {
            name: 'a numbered list toggled on and off in a quote', source: '> a\n>\n> b',
            steps: [
                command((editor) => { editor.toggleOrderedList(); }, ['a', 0], ['b', 1]),
                command((editor) => { editor.toggleOrderedList(); }),
            ],
            saved: '> a\n>\n> b',
        },
        {
            name: 'a table in a quote', source: '> ab',
            steps: [command((editor) => { editor.insertTable(2, 2); }, ['ab', 1])],
            saved: '> a\n>\n> |  |  |\n> | --- | --- |\n> |  |  |\n>\n> b',
        },
        {
            name: 'a table in an item\'s quote', source: '- > ab',
            steps: [command((editor) => { editor.insertTable(2, 2); }, ['ab', 1])],
            saved: '- > a\n  >\n  > |  |  |\n  > | --- | --- |\n  > |  |  |\n  >\n  > b',
        },
        {
            name: 'a table in a column\'s quote', source: '::: columns\n> ab\n|||\nc\n:::',
            steps: [command((editor) => { editor.insertTable(2, 2); }, ['ab', 1])],
            saved: '::: columns\n> a\n>\n> |  |  |\n> | --- | --- |\n> |  |  |\n>\n> b\n|||\nc\n:::',
        },
        {
            name: 'a table inserted after the quote\'s only table was deleted goes into the quote', source: '> | h |\n> | - |\n> | c |',
            steps: [command((editor) => { editor.deleteTable(); }, ['h', 0]), command((editor) => { editor.insertTable(2, 2); })],
            saved: '> |  |  |\n> | --- | --- |\n> |  |  |',
        },
        {
            name: 'the same in a nested quote', source: '> > | h |\n> > | - |\n> > | c |',
            steps: [command((editor) => { editor.deleteTable(); }, ['h', 0]), command((editor) => { editor.insertTable(2, 2); })],
            saved: '> > |  |  |\n> > | --- | --- |\n> > |  |  |',
        },
        {
            name: 'the same in a list item\'s quote', source: '- > | h |\n  > | - |\n  > | c |',
            steps: [command((editor) => { editor.deleteTable(); }, ['h', 0]), command((editor) => { editor.insertTable(2, 2); })],
            saved: '- > |  |  |\n  > | --- | --- |\n  > |  |  |',
        },
        {
            name: 'Backspace key after the quote\'s only table was deleted lifts the empty paragraph out of the quote', source: 'x\n\n> | h |\n> | - |\n> | c |',
            steps: [command((editor) => { editor.deleteTable(); }, ['h', 0]), { key: 'Backspace key' }],
            shape: 'paragraph("x") | paragraph()',
        },
        {
            name: 'read-only', source: '> a',
            steps: [command((editor) => { editor.setReadOnly(true); }), { key: 'Enter', at: ['a', 1] }], saved: '> a',
        },
    ])('$name', runRow);
});

describe('the quote command toggles', () => {
    it.each<Row>([
        { name: 'a paragraph goes into a quote', source: 'a', steps: [blockType('quote', ['a', 1])], saved: '> a' },
        { name: 'a quoted paragraph leaves its quote', source: '> a', steps: [blockType('quote', ['a', 1])], saved: 'a' },
        { name: 'two paragraphs go into one quote', source: 'a\n\nb', steps: [blockType('quote', ['a', 0], ['b', 1])], saved: '> a\n>\n> b' },
        {
            name: 'a middle paragraph leaves its quote', source: '> a\n>\n> b\n>\n> c',
            steps: [blockType('quote', ['b', 1])], saved: '> a\n\nb\n\n> c',
        },
        {
            name: 'a quote and a paragraph make one quote', source: '> a\n\nb',
            steps: [blockType('quote', ['a', 0], ['b', 1])], saved: '> a\n>\n> b',
        },
        {
            name: 'a paragraph between two quotes joins both', source: '> a\n\nb\n\n> c',
            steps: [blockType('quote', ['b', 1])], saved: '> a\n>\n> b\n>\n> c',
        },
        {
            name: 'a range over a nested quote takes each block out of its nearest quote only', source: '> a\n>\n> > b\n>\n> c',
            steps: [blockType('quote', ['a', 0], ['c', 1])], saved: 'a\n\n> b\n\nc',
        },
        {
            name: 'a range over only the blocks of a nested quote takes them into the outer quote', source: '> a\n>\n> > b\n>\n> c',
            steps: [blockType('quote', ['b', 0], ['b', 1])], saved: '> a\n>\n> b\n>\n> c',
        },
        {
            name: 'a range from a nested quote into a later block of the outer quote', source: '> a\n>\n> > b\n>\n> c',
            steps: [blockType('quote', ['b', 0], ['c', 1])], saved: '> a\n>\n> b\n\nc',
        },
        {
            name: 'a range three levels deep takes each block out of one quote', source: '> a\n>\n> > b\n> >\n> > > c',
            steps: [blockType('quote', ['a', 0], ['c', 1])], saved: 'a\n\n> b\n>\n> > c',
        },
        { name: 'a nested quote goes out one level', source: '> > a', steps: [blockType('quote', ['a', 1])], saved: '> a' },
        { name: 'a quote\'s list leaves the quote', source: '> - a\n> - b', steps: [blockType('quote', ['a', 1])], saved: '- a\n- b' },
        { name: 'an item\'s text goes into a quote', source: '- a\n- b', steps: [blockType('quote', ['a', 1])], saved: '> a\n\n- b' },
        { name: 'an item\'s further paragraph goes into a quote', source: '- a\n\n  p', steps: [blockType('quote', ['p', 1])], saved: '- a\n\n  > p' },
        { name: 'a raw block goes into a quote and stays raw', source: '<div>x</div>', steps: [blockType('quote', ['<div>x</div>', 3])], saved: '> <div>x</div>', comparesWithViewer: false },
        { name: 'a heading goes into a quote', source: '## h', steps: [blockType('quote', ['h', 1])], saved: '> ## h' },
        { name: 'code goes into a quote', source: '```js\nx\n```', steps: [blockType('quote', ['x', 1])], saved: '> ```js\n> x\n> ```' },
        {
            name: 'a column\'s paragraph goes into a quote', source: '::: columns\na\n|||\nb\n:::',
            steps: [blockType('quote', ['a', 1])], saved: '::: columns\n> a\n|||\nb\n:::',
        },
        { name: 'toggled twice', source: 'a', steps: [blockType('quote', ['a', 1]), blockType('quote')], saved: 'a' },
        {
            name: 'one undo step', source: 'a\n\nb',
            steps: [blockType('quote', ['a', 0], ['b', 1]), { key: 'undo' }], saved: 'a\n\nb',
        },
        {
            name: 'joins the quote before', source: '> a\n\nb',
            steps: [blockType('quote', ['b', 1]), blockType('quote')], savedAfter: ['> a\n>\n> b', '> a\n\nb'],
        },
        { name: 'joins the quote after', source: 'a\n\n> b', steps: [blockType('quote', ['a', 1])], saved: '> a\n>\n> b' },
        { name: 'two item texts', source: '- a\n- b', steps: [blockType('quote', ['a', 0], ['b', 1])], saved: '> a\n>\n> b' },
        { name: 'a range over two quotes', source: '> a\n\n> b', steps: [blockType('quote', ['a', 0], ['b', 1])], saved: 'a\n\nb' },
    ])('$name', runRow);
});

describe('block typing shortcuts apply in a quote', () => {
    it.each<Row>([
        {
            name: 'the caret after a shortcut in a quote', source: '> a\n>\n> b',
            steps: [typeText('-', ['b', 0]), typeText(' ')], saved: '> a\n>\n> - b', caretStartsBlock: 'b',
            shape: 'markdown-quote(paragraph("a"), list(markdown-list-item(markdown-list-item-text("b"))))',
        },
        { name: 'a shortcut joins the list after it', source: '> b\n>\n> - c', steps: [typeText('-', ['b', 0]), typeText(' ')], saved: '> - b\n> - c' },
        {
            name: 'a code fence with a language, on Enter', source: '> a',
            steps: [{ key: 'Enter', at: ['a', 1] }, typeText('```js'), { key: 'Enter' }, typeText('x')], saved: '> a\n>\n> ```js\n> x\n> ```',
        },
        {
            name: 'a bullet marker in an empty paragraph', source: '> a',
            steps: [{ key: 'Enter', at: ['a', 1] }, typeText('-'), typeText(' ')], saved: '> a\n>\n> -',
            shape: 'markdown-quote(paragraph("a"), list(markdown-list-item(markdown-list-item-text())))',
        },
        { name: 'no shortcut in an item\'s own text', source: '- a', steps: [typeText('#', ['a', 0]), typeText(' ')], saved: '- \\# a' },
        { name: 'no list shortcut in a heading', source: '> # h', steps: [typeText('-', ['h', 0]), typeText(' ')], saved: '> # - h' },
        { name: 'no shortcut in the middle of text', source: '> ab', steps: [typeText('-', ['ab', 1]), typeText(' ')], saved: '> a- b' },
        {
            name: 'a bold paragraph keeps its format', source: '> a\n>\n> **b** c',
            steps: [typeText('-', ['b', 0]), typeText(' ')], saved: '> a\n>\n> - **b** c',
        },
        // A one-paragraph quote was Lexical's own quote, where Lexical's shortcuts replaced the quote; now the shortcut builds in it.
        { name: 'a bullet in a one-paragraph quote stays in the quote', source: '> b', steps: [typeText('-', ['b', 0]), typeText(' ')], saved: '> - b' },
        { name: 'a heading in a one-paragraph quote stays in the quote', source: '> b', steps: [typeText('#', ['b', 0]), typeText(' ')], saved: '> # b' },
        { name: 'a quote in a one-paragraph quote nests', source: '> b', steps: [typeText('>', ['b', 0]), typeText(' ')], saved: '> > b' },
        {
            name: 'a code fence in a one-paragraph quote stays in the quote', source: '> b',
            steps: [typeText('```', ['b', 0]), typeText(' ')], saved: '> ```\n> b\n> ```',
        },
        { name: 'a bullet in a quote', source: '> a\n>\n> b', steps: [typeText('-', ['b', 0]), typeText(' ')], saved: '> a\n>\n> - b' },
        { name: 'a number in a quote', source: '> a\n>\n> b', steps: [typeText('3.', ['b', 0]), typeText(' ')], saved: '> a\n>\n> 3. b' },
        { name: 'a heading in a quote', source: '> a\n>\n> b', steps: [typeText('##', ['b', 0]), typeText(' ')], saved: '> a\n>\n> ## b' },
        { name: 'a quote in a quote', source: '> a\n>\n> b', steps: [typeText('>', ['b', 0]), typeText(' ')], saved: '> a\n>\n> > b' },
        { name: 'a bullet in a nested quote', source: '> > a\n> >\n> > b', steps: [typeText('-', ['b', 0]), typeText(' ')], saved: '> > a\n> >\n> > - b' },
        { name: 'a bullet in a list item\'s further paragraph', source: '- a\n\n  b', steps: [typeText('-', ['b', 0]), typeText(' ')], saved: '- a\n\n  - b' },
        { name: 'a heading in a list item\'s further paragraph', source: '- a\n\n  b', steps: [typeText('#', ['b', 0]), typeText(' ')], saved: '- a\n\n  # b' },
        { name: 'a quote in a list item\'s further paragraph', source: '- a\n\n  b', steps: [typeText('>', ['b', 0]), typeText(' ')], saved: '- a\n\n  > b' },
    ])('$name', runRow);
});

/** A clipboard: the nodes copied from `from` to `to` in a document of their own. */
interface Clipboard {
    readonly source: string;
    readonly from:   TextPoint;
    readonly to:     TextPoint;
}

/**
 * Copies the selection as Lexical's clipboard does.
 *
 * @param clipboard - What to copy.
 * @returns The copied nodes.
 */
function copied(clipboard: Clipboard): ReturnType<typeof $generateJSONFromSelectedNodes>['nodes'] {
    const editor = load(clipboard.source);
    const lexical = lexicalOf(editor);

    selectText(editor, clipboard.from, clipboard.to);

    return lexical.read(() => $generateJSONFromSelectedNodes(lexical, $getSelection()).nodes);
}

/**
 * Pastes copied nodes at the selection as Ctrl/Cmd+V does.
 *
 * @param editor - The editor.
 * @param nodes - The copied nodes.
 */
function pasteNodes(editor: MarkdownEditor, nodes: ReturnType<typeof copied>): void {
    const lexical = lexicalOf(editor);
    const data: Record<string, string> = {
        'application/x-lexical-editor': JSON.stringify({ namespace: lexical._config.namespace, nodes }),
    };

    // `registerRichText`'s paste handler tells clipboard, drag, input and key events apart by class name.
    vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
    vi.stubGlobal('DragEvent', class DragEvent {});
    vi.stubGlobal('InputEvent', class InputEvent {});
    vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});

    const event = Object.assign(new ClipboardEvent('paste'), {
        clipboardData: { types: Object.keys(data), files: [], getData: (type: string) => data[type] ?? '' }, preventDefault: () => {},
    });

    lexical.update(() => {
        lexical.dispatchCommand(PASTE_COMMAND, event);
    }, { discrete: true });
}

describe('blocks pasted into a quote stay in it', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each<[string, string, Clipboard, TextPoint, string]>([
        ['paragraphs into a quote\'s paragraph', '> cd', { source: 'P1\n\nP2', from: ['P1', 0], to: ['P2', 2] }, ['cd', 1], '> cP1\n>\n> P2d'],
        ['a heading and a paragraph', '> cd', { source: '## H\n\nP2', from: ['H', 0], to: ['P2', 2] }, ['cd', 1], '> cH\n>\n> P2d'],
        [
            'a quote into a paragraph', 'cd', { source: '> Q1\n>\n> Q2\n\nP2', from: ['Q1', 0], to: ['P2', 2] }, ['cd', 1],
            'c\n\n> Q1\n>\n> Q2\n\nP2d',
        ],
        [
            'a quote into a quote\'s paragraph', '> cd', { source: '> Q1\n>\n> Q2\n\nP2', from: ['Q1', 0], to: ['P2', 2] }, ['cd', 1],
            '> c\n>\n> > Q1\n> >\n> > Q2\n>\n> P2d',
        ],
        [
            'paragraphs into an item\'s quote', '- x\n\n  > cd\n- z', { source: 'P1\n\nP2', from: ['P1', 0], to: ['P2', 2] }, ['cd', 1],
            '- x\n\n  > cP1\n  >\n  > P2d\n\n- z',
        ],
        ['plain text, which the handler declines', '> cd', { source: 'P1 zz', from: ['P1 zz', 0], to: ['P1 zz', 2] }, ['cd', 1], '> cP1d'],
    ])('%s', (_name, target, clipboard, at, saved) => {
        const editor = load(target);
        const nodes = copied(clipboard);

        expectSaveKeepsDocument(editor, 'the load');
        selectText(editor, at);
        pasteNodes(editor, nodes);
        expectSaveKeepsDocument(editor, 'the paste');
        expect(editor.getValue()).toBe(saved);

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        expect(editor.getValue()).toBe(target);
    });
});
