// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// MarkdownEditor holds a horizontal rule as a node of its own
// (plans/markdown-horizontal-rules.md): what a load builds, what a save
// writes, where a rule can stand, and what each edit does beside one. After
// every step the save loads as the document the editor shows, and the viewer
// reads it the same way.

// Keeps `@lexical/clipboard`'s real module (`@lexical/rich-text` imports it for its paste path) and replaces
// `copyToClipboard`, which needs a browser clipboard the test DOM does not have, and
// `$getClipboardDataFromSelection`, which needs a browser document: here it gives the selection's text and its nodes.
vi.mock('@lexical/clipboard', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@lexical/clipboard')>();
    const { $getEditor } = await import('lexical');

    return {
        ...actual,
        copyToClipboard:                vi.fn(async () => true),
        $getClipboardDataFromSelection: vi.fn((selection: import('lexical').BaseSelection) => ({
            'text/plain':                    selection.getTextContent(),
            'application/x-lexical-editor': JSON.stringify(actual.$generateJSONFromSelectedNodes($getEditor(), selection)),
        })),
    };
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createNodeSelection, $createParagraphNode, $createRangeSelection, $createTextNode, $getNodeByKey, $getRoot, $isNodeSelection, $selectAll,
    CUT_COMMAND, KEY_ARROW_DOWN_COMMAND, KEY_ARROW_LEFT_COMMAND, KEY_ARROW_RIGHT_COMMAND, KEY_ARROW_UP_COMMAND, KEY_DELETE_COMMAND, $getSelection, $isElementNode, $isRangeSelection, $isTextNode, $setSelection,
    CONTROLLED_TEXT_INSERTION_COMMAND, DELETE_CHARACTER_COMMAND, INSERT_LINE_BREAK_COMMAND,
    KEY_BACKSPACE_COMMAND, KEY_ENTER_COMMAND, DELETE_WORD_COMMAND, DELETE_LINE_COMMAND, INDENT_CONTENT_COMMAND, OUTDENT_CONTENT_COMMAND, PASTE_COMMAND, UNDO_COMMAND, $setState,
} from 'lexical';
import type { ElementNode, LexicalCommand, LexicalEditor, LexicalNode, TextNode } from 'lexical';
import { $generateJSONFromSelectedNodes, copyToClipboard } from '@lexical/clipboard';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { $dfs } from '@lexical/utils';
import { $classifyContextMenuTarget, MarkdownEditor } from '~/component/editor/MarkdownEditor';
import type { MarkdownBlockType } from '~/component/editor/MarkdownEditor';
import { $isMarkdownRawBlockNode } from '~/component/editor/markdownSourceNodes';
import { $createMarkdownHorizontalRuleNode, $isMarkdownHorizontalRuleNode } from '~/component/editor/markdownHorizontalRuleNode';
import { $createMarkdownListItemTextNode } from '~/component/editor/markdownListItemNode';
import { $createMarkdownQuoteNode } from '~/component/editor/markdownQuoteNode';
import { $createMarkdownBlockNode, $createMarkdownColumnNode } from '~/component/editor/markdownBlockNode';
import { listMarkerState } from '~/component/editor/markdownNodeState';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { canonicalSave, editorDefinitions, viewerDefinitions } from './markdown-roundtrip/harness';
import { blockOutline, editorSurfaceModel, viewerModel } from './markdown-roundtrip/viewModel';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => {
    installTestDOM(CONFIG);

    // `registerRichText`'s handlers tell clipboard, drag, input and key events apart by class name.
    vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
    vi.stubGlobal('DragEvent', class DragEvent {});
    vi.stubGlobal('InputEvent', class InputEvent {});
    vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});
});
afterEach(() => {
    DOM.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(copyToClipboard).mockClear();
});

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


/** The shape of a horizontal rule in a row's `shape`. */
const RULE = 'markdown-horizontal-rule';

describe('a horizontal rule loads as a node of its own and saves as it was written', () => {
    it.each<Row>([
        {
            name:     'a rule between paragraphs',
            source:   'a\n\n---\n\nb',
            steps:    [],
            shape:    `paragraph("a") | ${RULE} | paragraph("b")`,
            saved:    'a\n\n---\n\nb',
            standard: 'a\n\n---\n\nb',
        },
        {
            name:     'a rule of stars',
            source:   '***',
            steps:    [],
            shape:    RULE,
            saved:    '***',
            standard: '***',
        },
        {
            name:     'an indented spaced rule',
            source:   '  * * *  ',
            steps:    [],
            shape:    RULE,
            saved:    '  * * *  ',
            standard: '* * *',
        },
        {
            name:     'a rule in a list item',
            source:   '- a\n\n  ___\n- b',
            steps:    [],
            shape:    `list(markdown-list-item(markdown-list-item-text("a"), ${RULE}), markdown-list-item(markdown-list-item-text("b")))`,
            saved:    '- a\n\n  ___\n- b',
            standard: '- a\n\n  ___\n\n- b',
        },
        {
            name:     'a rule in a quote',
            source:   '> a\n>\n> ---',
            steps:    [],
            shape:    `markdown-quote(paragraph("a"), ${RULE})`,
            saved:    '> a\n>\n> ---',
            standard: '> a\n>\n> ---',
        },
        {
            name:     'a rule in a column',
            source:   '::: columns\na\n|||\n---\n:::',
            steps:    [],
            shape:    `markdown-block(markdown-column(paragraph("a")), markdown-column(${RULE}))`,
            saved:    '::: columns\na\n|||\n---\n:::',
            standard: '::: columns\na\n|||\n---\n:::',
        },
        {
            name:     'a rule opening an item',
            source:   '- ***\n- b',
            steps:    [],
            shape:    `list(markdown-list-item(${RULE}), markdown-list-item(markdown-list-item-text("b")))`,
            saved:    '- ***\n- b',
            standard: '- ***\n- b',
        },
        {
            name:     'a rule of dashes opening an item of a star list',
            source:   '* ---\n* b',
            steps:    [],
            shape:    `list(markdown-list-item(${RULE}), markdown-list-item(markdown-list-item-text("b")))`,
            saved:    '* ---\n* b',
            standard: '* ---\n* b',
        },
        {
            name:     'a rule interrupting a paragraph',
            source:   'a\n***\nb',
            steps:    [],
            shape:    `paragraph("a") | ${RULE} | paragraph("b")`,
            saved:    'a\n***\nb',
            standard: 'a\n\n***\n\nb',
        },
        {
            name:     'a rule between two lists',
            source:   '- foo\n***\n- bar',
            steps:    [],
            shape:    `list(markdown-list-item(markdown-list-item-text("foo"))) | ${RULE} | list(markdown-list-item(markdown-list-item-text("bar")))`,
            saved:    '- foo\n***\n- bar',
        },
        {
            name:     'dashes under text stay a heading',
            source:   'a\n---',
            steps:    [],
            shape:    'heading("a")',
            saved:    'a\n---',
        },
        {
            name:     'a rule of tabs',
            source:   '*\t*\t*',
            steps:    [],
            shape:    RULE,
            saved:    '*\t*\t*',
        },
    ])('$name', runRow);
});

// ---------------------------------------------------------------- every placement saves so that it reloads as shown

/**
 * A paragraph holding `text`.
 *
 * @param text - The text.
 * @returns The node.
 */
function paragraphOf(text: string): LexicalNode {
    return $createParagraphNode().append($createTextNode(text));
}

/**
 * An item's text holding `text`.
 *
 * @param text - The text; none for an emptied item text.
 * @returns The node.
 */
function itemText(text: string): LexicalNode {
    return text === '' ? $createMarkdownListItemTextNode() : $createMarkdownListItemTextNode().append($createTextNode(text));
}

/**
 * A list item holding `children`.
 *
 * @param children - The item's blocks.
 * @returns The node.
 */
function itemOf(...children: LexicalNode[]): LexicalNode {
    return $createListItemNode().append(...children);
}

/**
 * A list of the kind a marker names.
 *
 * @param marker - `-`, `*`, `+` for a bullet list, `.` for an ordered list.
 * @param items - The list's items.
 * @returns The node.
 */
function listOf(marker: string, ...items: LexicalNode[]): LexicalNode {
    const list = $createListNode(marker === '.' ? 'number' : 'bullet');

    $setState(list, listMarkerState, marker);

    return list.append(...items);
}

/** The lines a rule is written with: made in the editor (`''`), and each of the written forms. */
const RULE_LINES: readonly string[] = ['', '***', '___', '- - -', '* * *', '-----'];

/** The kinds of list a rule is put in. */
const LIST_MARKERS: readonly string[] = ['-', '*', '+', '.'];

/** A document built by hand, named for the failure message. */
type Placement = readonly [name: string, build: () => LexicalNode[]];

/**
 * Every place a rule can stand, for one written form of it and one kind of list.
 *
 * @param line - The rule's written form; `''` for a rule made in the editor.
 * @param marker - The kind of list.
 * @returns The placements.
 */
function placementsInList(line: string, marker: string): Placement[] {
    const rule = (): LexicalNode => $createMarkdownHorizontalRuleNode(line);
    const label = line === '' ? 'new' : line;

    return [
        [`opening an item of a ${marker} list, rule ${label}`, () => [listOf(marker, itemOf(rule()), itemOf(itemText('b')))]],
        [`after an item's text in a ${marker} list, rule ${label}`, () => [listOf(marker, itemOf(itemText('a'), rule()), itemOf(itemText('b')))]],
        [`opening a ${marker} list nested right under an item's text, rule ${label}`, () => [listOf('-', itemOf(itemText('a'), listOf(marker, itemOf(rule()), itemOf(itemText('c')))))]],
        [`after an emptied item text in a ${marker} list, rule ${label}`, () => [listOf(marker, itemOf(itemText(''), rule()), itemOf(itemText('b')))]],
        [`opening the only item of a ${marker} list, rule ${label}`, () => [listOf(marker, itemOf(rule()))]],
        [`before a nested ${marker} list in its item, rule ${label}`, () => [listOf('-', itemOf(rule(), listOf(marker, itemOf(itemText('n')))))]],
    ];
}

/**
 * Every place a rule can stand outside a list's items, for one written form of it.
 *
 * @param line - The rule's written form; `''` for a rule made in the editor.
 * @returns The placements.
 */
function placementsOutsideLists(line: string): Placement[] {
    const rule = (): LexicalNode => $createMarkdownHorizontalRuleNode(line);
    const label = line === '' ? 'new' : line;

    return [
        [`alone, rule ${label}`, () => [rule()]],
        [`between two paragraphs, rule ${label}`, () => [paragraphOf('a'), rule(), paragraphOf('b')]],
        [`between two lists of one marker, rule ${label}`, () => [listOf('-', itemOf(itemText('a'))), rule(), listOf('-', itemOf(itemText('b')))]],
        [`in a quote, rule ${label}`, () => [$createMarkdownQuoteNode().append(rule())]],
        [`between two paragraphs of a quote, rule ${label}`, () => [$createMarkdownQuoteNode().append(paragraphOf('a'), rule(), paragraphOf('b'))]],
        [`in a column, rule ${label}`, () => [$createMarkdownBlockNode()
            .append($createMarkdownColumnNode().append(rule()), $createMarkdownColumnNode().append(paragraphOf('x')))]],
        [`twice in a row, rule ${label}`, () => [rule(), rule()]],
        [`between paragraphs reading --- and ***, rule ${label}`, () => [paragraphOf('---'), rule(), paragraphOf('***')]],
        [`after an item's text and before its nested list, rule ${label}`, () => [listOf('-', itemOf(itemText('a'), rule(), listOf('-', itemOf(itemText('n')))))]],
    ];
}

/** The 198 documents: each written form of a rule, in each place. */
const PLACEMENTS: readonly Placement[] = RULE_LINES.flatMap((line) => [
    ...LIST_MARKERS.flatMap((marker) => placementsInList(line, marker)),
    ...placementsOutsideLists(line),
]);

describe('a rule saves so that it reloads as shown, in every place it can stand', () => {
    it('covers the 198 documents the plan counts', () => {
        expect(PLACEMENTS).toHaveLength(198);
    });

    it.each(PLACEMENTS)('%s', (_name, build) => {
        const editor = load('x');

        lexicalOf(editor).update(() => {
            $getRoot().clear().append(...build());
        }, { discrete: true });

        const saved = editor.getValue();
        const shown = editorSurfaceModel(editor);
        const reloaded = load(saved);

        expect(blockOutline(viewerModel(saved).blocks), `the viewer reads ${JSON.stringify(saved)}`).toBe(blockOutline(shown));
        expect(blockOutline(editorSurfaceModel(reloaded)), `the reload of ${JSON.stringify(saved)}`).toBe(blockOutline(shown));
        expect(reloaded.getValue(), 'the save saves again unchanged').toBe(saved);
    });

    it.each<readonly [string, () => LexicalNode[], string]>([
        ['a new rule opening an item of a - list', () => [listOf('-', itemOf(placed()), itemOf(itemText('b')))], '-\n  ---\n- b'],
        ['a new rule in a list nested right under the text of an item', () => [listOf('-', itemOf(itemText('a'), listOf('*', itemOf(placed()), itemOf(itemText('c')))))], '- a\n  * ---\n  * c'],
        ['*** opening an item of a * list', () => [listOf('*', itemOf(placed('***')), itemOf(itemText('b')))], '*\n  ***\n* b'],
        ['*** opening an item of a - list', () => [listOf('-', itemOf(placed('***')), itemOf(itemText('b')))], '- ***\n- b'],
        ['- - - opening an item of a - list', () => [listOf('-', itemOf(placed('- - -')), itemOf(itemText('b')))], '-\n  - - -\n- b'],
        ['- - - opening an item of a * list', () => [listOf('*', itemOf(placed('- - -')), itemOf(itemText('b')))], '* - - -\n* b'],
        ['a new rule opening an ordered item', () => [listOf('.', itemOf(placed()))], '1. ---'],
        ['a new rule in a quote', () => [$createMarkdownQuoteNode().append(placed())], '> ---'],
        ['a new rule in a column', () => [$createMarkdownBlockNode()
            .append($createMarkdownColumnNode().append(placed()), $createMarkdownColumnNode().append(paragraphOf('x')))], '::: columns\n---\n|||\nx\n:::'],
        ['an item holding a new rule, then a nested list', () => [listOf('-', itemOf(placed(), listOf('-', itemOf(itemText('n')))))], '-\n  ---\n\n  - n'],
    ])('writes %s as pinned', (_name, build, expected) => {
        const editor = load('x');

        lexicalOf(editor).update(() => {
            $getRoot().clear().append(...build());
        }, { discrete: true });

        expect(editor.getValue()).toBe(expected);
    });
});

/**
 * A rule for a hand-built document.
 *
 * @param line - The rule's written form; none for a rule made in the editor.
 * @returns The node.
 */
function placed(line: string = ''): LexicalNode {
    return $createMarkdownHorizontalRuleNode(line);
}

// ---------------------------------------------------------------- selecting and deleting

/** The stand-in event the arrow, Delete, Backspace and Enter key commands take; Lexical's handlers only call these. */
const KEY_EVENT = { preventDefault: () => {}, stopPropagation: () => {}, shiftKey: false, target: null } as unknown as KeyboardEvent;

/**
 * Puts a node selection on the nth horizontal rule of the document, as a click on it does.
 *
 * @param editor - The editor.
 * @param index - Which rule, in document order.
 */
function selectRule(editor: MarkdownEditor, index: number = 0): void {
    lexicalOf(editor).update(() => {
        const rules = $dfs($getRoot()).map(({ node }) => node).filter($isMarkdownHorizontalRuleNode);
        const selection = $createNodeSelection();

        selection.add(rules[index]!.getKey());
        $setSelection(selection);
    }, { discrete: true });
}

/**
 * Lets the updates a command starts commit.
 *
 * @param editor - The editor.
 */
function settle(editor: MarkdownEditor): void {
    lexicalOf(editor).read(() => null);
    lexicalOf(editor).read(() => null);
}

/**
 * What the selection holds, in words: `node[rule]` for a selected rule, otherwise the text of the block the caret
 * stands in and its offset in that text (`b@0`), with `..` and the second end for a range.
 *
 * @param editor - The editor.
 * @returns The description.
 */
function selectionOf(editor: MarkdownEditor): string {
    return lexicalOf(editor).read(() => {
        const selection = $getSelection();

        if ($isNodeSelection(selection)) {
            return `node[${selection.getNodes().map((node) => node.getType() === RULE ? 'rule' : node.getType()).join(',')}]`;
        }

        if (!$isRangeSelection(selection)) {
            return String(selection);
        }

        const place = (point: typeof selection.anchor): string => {
            const node = point.getNode();
            const block = $isTextNode(node) ? node.getParentOrThrow() : node;
            const before = $isTextNode(node)
                ? node.getPreviousSiblings().reduce((total, sibling) => total + sibling.getTextContentSize(), 0) + point.offset
                : (block as ElementNode).getChildren().slice(0, point.offset).reduce((total, child) => total + child.getTextContentSize(), 0);

            return `${JSON.stringify(block.getTextContent())}@${before}`;
        };

        return selection.isCollapsed() ? place(selection.anchor) : `${place(selection.anchor)}..${place(selection.focus)}`;
    });
}

/**
 * A step that dispatches one command to the editor.
 *
 * @param lexicalCommand - The command.
 * @param payload - Its payload.
 * @returns The step.
 */
function dispatch<P>(lexicalCommand: LexicalCommand<P>, payload: P): Step {
    return command((editor) => { lexicalOf(editor).dispatchCommand(lexicalCommand, payload); });
}

/**
 * Loads a document, makes the steps, and checks the save and the selection after each; after each the save keeps the
 * document.
 *
 * @param source - The Markdown to load.
 * @param steps - Each step with the save and, where the row pins it, the selection after it.
 * @returns The editor.
 */
function walk(source: string, steps: ReadonlyArray<readonly [step: Step, saved: string, selection?: string]>): MarkdownEditor {
    const editor = load(source);

    expectSaveKeepsDocument(editor, 'the load');

    steps.forEach(([step, saved, selection], index) => {
        press(editor, step);
        settle(editor);

        expect(editor.getValue(), `save after step ${index + 1} (${step.key})`).toBe(saved);

        if (selection !== undefined) {
            expect(selectionOf(editor), `selection after step ${index + 1} (${step.key})`).toBe(selection);
        }

        expectSaveKeepsDocument(editor, `step ${index + 1} (${step.key})`);
    });

    return editor;
}

describe('Backspace and Delete beside a rule remove it', () => {
    it.each<[string, Step]>([
        ['Backspace', { key: 'Backspace', at: ['b', 0] }],
        ['Backspace key', { key: 'Backspace key', at: ['b', 0] }],
    ])('%s after a rule removes it', (_name, step) => {
        walk('a\n\n---\n\nb', [[step, 'a\n\nb', '"b"@0']]);
    });

    it('Delete before a rule removes it', () => {
        walk('a\n\n---\n\nb', [[{ key: 'Delete', at: ['a', 1] }, 'a\n\nb', '"a"@1']]);
    });

    it('Backspace in an empty paragraph after a rule selects it, a key then removes it, and one undo brings it back selected', () => {
        const editor = walk('a\n\n---\n\nb', [
            [{ key: 'Backspace', at: ['b', 0], to: ['b', 1] }, 'a\n\n---', '""@0'],
            [{ key: 'Backspace' }, 'a\n\n---', 'node[rule]'],
            [{ key: 'Backspace key' }, 'a'],
            [{ key: 'undo' }, 'a\n\n---', 'node[rule]'],
        ]);

        expect(shapeOf(editor)).toBe(`paragraph("a") | ${RULE}`);
    });
});

describe('the keys on a selected rule', () => {
    const DOCUMENT = 'a\n\n---\n\nb';

    it.each<[string, Step]>([
        ['Delete key', dispatch(KEY_DELETE_COMMAND, KEY_EVENT)],
        ['Backspace key', dispatch(KEY_BACKSPACE_COMMAND, KEY_EVENT)],
    ])('%s removes it', (_name, step) => {
        const editor = load(DOCUMENT);

        selectRule(editor);
        press(editor, step);

        expect(editor.getValue()).toBe('a\n\nb');
        expectSaveKeepsDocument(editor, 'the key');
    });

    it.each<[string, Step, string]>([
        ['ArrowLeft', dispatch(KEY_ARROW_LEFT_COMMAND, KEY_EVENT), '"a"@1'],
        ['ArrowUp', dispatch(KEY_ARROW_UP_COMMAND, KEY_EVENT), '"a"@1'],
        ['ArrowRight', dispatch(KEY_ARROW_RIGHT_COMMAND, KEY_EVENT), '"b"@0'],
        ['ArrowDown', dispatch(KEY_ARROW_DOWN_COMMAND, KEY_EVENT), '"b"@0'],
    ])('%s puts the caret beside it', (_name, step, caret) => {
        const editor = load(DOCUMENT);

        selectRule(editor);
        press(editor, step);

        expect(selectionOf(editor)).toBe(caret);
        expect(editor.getValue()).toBe(DOCUMENT);
    });

    it('Enter opens an empty paragraph after the rule and leaves the caret at the start of the next block', () => {
        const editor = load(DOCUMENT);

        selectRule(editor);
        press(editor, { key: 'Enter' });

        expect(shapeOf(editor)).toBe(`paragraph("a") | ${RULE} | paragraph() | paragraph("b")`);
        expect(selectionOf(editor)).toBe('"b"@0');
        expectSaveKeepsDocument(editor, 'Enter');
    });

    it('a typed character changes nothing', () => {
        const editor = load(DOCUMENT);

        selectRule(editor);
        press(editor, { key: 'type', text: 'Z' });

        expect(editor.getValue()).toBe(DOCUMENT);
        expect(selectionOf(editor)).toBe('node[rule]');
    });

    it('a lone rule selected and deleted leaves an empty document', () => {
        const editor = load('---');

        selectRule(editor);
        press(editor, dispatch(KEY_DELETE_COMMAND, KEY_EVENT));

        expect(editor.getValue()).toBe('');
        expectSaveKeepsDocument(editor, 'Delete key');
    });
});

describe('the arrows beside a rule select it', () => {
    it('ArrowLeft at the start of the block after it', () => {
        const editor = load('a\n\n---\n\nb');

        selectText(editor, ['b', 0]);
        press(editor, dispatch(KEY_ARROW_LEFT_COMMAND, KEY_EVENT));

        expect(selectionOf(editor)).toBe('node[rule]');
    });

    it('ArrowRight at the end of the block before it', () => {
        const editor = load('a\n\n---\n\nb');

        selectText(editor, ['a', 1]);
        press(editor, dispatch(KEY_ARROW_RIGHT_COMMAND, KEY_EVENT));

        expect(selectionOf(editor)).toBe('node[rule]');
    });
});

describe('a range over a rule', () => {
    const DOCUMENT = 'a1\n\n---\n\nb1';

    it.each<[string, Step, string]>([
        ['Delete', { key: 'Delete', at: ['a1', 1], to: ['b1', 1] }, 'a1'],
        ['typing Z', { key: 'type', text: 'Z', at: ['a1', 1], to: ['b1', 1] }, 'aZ1'],
        ['Enter', { key: 'Enter', at: ['a1', 1], to: ['b1', 1] }, 'a\n\n1'],
    ])('%s', (_name, step, saved) => {
        walk(DOCUMENT, [[step, saved]]);
    });
});

describe('Backspace after a rule in a container', () => {
    it.each<[string, string, TextPoint, string]>([
        ['in an item', '- a\n\n  ---\n\n  b', ['b', 0], '- a\n\n  b'],
        ['in a quote', '> a\n>\n> ---\n>\n> b', ['b', 0], '> a\n>\n> b'],
        ['at an item\'s start', '-\n  ---\n\n  b', ['b', 0], '- b'],
        ['in a column', '::: columns\n---\n\nb\n|||\nx\n:::', ['b', 0], '::: columns\nb\n|||\nx\n:::'],
    ])('%s', (_name, source, at, saved) => {
        walk(source, [[{ key: 'Backspace', at }, saved]]);
    });
});

describe('a deletion beside a list or quote whose edge block is a rule', () => {
    it('Backspace at the start of a block after a list ending with a rule removes the rule', () => {
        walk('- a\n\n  ---\n\nb', [[{ key: 'Backspace', at: ['b', 0] }, '- a\n\nb']]);
    });

    it('Backspace at the start of a block after a quote ending with a rule removes the rule', () => {
        walk('> a\n>\n> ---\n\nb', [[{ key: 'Backspace', at: ['b', 0] }, '> a\n\nb']]);
    });

    it('Delete at the end of a block before a list opening with a rule removes the rule and leaves the emptied item', () => {
        walk('a\n\n- ***\n- b', [[{ key: 'Delete', at: ['a', 1] }, 'a\n\n-\n- b']]);
    });

    it('Delete at the end of a block before a quote opening with a rule removes the rule', () => {
        walk('a\n\n> ---\n>\n> b', [[{ key: 'Delete', at: ['a', 1] }, 'a\n\n> b']]);
    });

    it('Backspace in an empty paragraph after a list ending with a rule removes the paragraph and selects the rule', () => {
        walk('- a\n\n  ---\n\nb', [
            [{ key: 'Backspace', at: ['b', 0], to: ['b', 1] }, '- a\n\n  ---'],
            [{ key: 'Backspace' }, '- a\n\n  ---', 'node[rule]'],
        ]);
    });
});

// ---------------------------------------------------------------- a range end beside a rule takes the rule

/**
 * Selects the whole document, as Select All does.
 *
 * @param editor - The editor.
 */
function selectAllOf(editor: MarkdownEditor): void {
    lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });
}

describe('Select All over a rule at the document\'s edge', () => {
    it.each<[string, string, string, string, string]>([
        ['a rule opening a document of an item and a quote', '---\n\n- x\n  > q', '', 'Z', ''],
        ['a rule before a paragraph', '---\n\nab', '', 'Z', ''],
        ['a rule after a paragraph', 'ab\n\n---', '', 'Z', ''],
        ['a lone rule', '---', '', 'Z', ''],
    ])('%s: Delete, typing Z and Enter', (_name, source, afterDelete, afterTyping, afterEnter) => {
        const deleted = load(source);

        selectAllOf(deleted);
        press(deleted, { key: 'Delete' });

        expect(deleted.getValue()).toBe(afterDelete);
        expectSaveKeepsDocument(deleted, 'Delete');

        const typed = load(source);

        selectAllOf(typed);
        press(typed, { key: 'type', text: 'Z' });

        expect(typed.getValue()).toBe(afterTyping);
        expectSaveKeepsDocument(typed, 'typing');

        if (source === '---\n\nab' || source === 'ab\n\n---') {
            return;
        }

        const entered = load(source);

        selectAllOf(entered);
        press(entered, { key: 'Enter' });

        expect(entered.getValue()).toBe(afterEnter);
        expectSaveKeepsDocument(entered, 'Enter');
    });

    it('over a rule and a table leaves the table emptied, as it does without the rule', () => {
        const table = '| h |\n| --- |\n| c |';
        const withRule = load(`---\n\n${table}`);
        const without = load(table);

        selectAllOf(withRule);
        press(withRule, { key: 'Delete' });
        selectAllOf(without);
        press(without, { key: 'Delete' });

        expect(withRule.getValue()).toBe(without.getValue());
    });

    it('Ctrl+X (CUT_COMMAND) copies the rule and the text, then removes them', async () => {
        const editor = load('---\n\nab');

        selectAllOf(editor);
        lexicalOf(editor).dispatchCommand(CUT_COMMAND, null);

        await vi.waitFor(() => expect(editor.getValue()).toBe(''));

        const data = vi.mocked(copyToClipboard).mock.calls[0]![2] as { 'application/x-lexical-editor'?: string } | undefined;

        expect(copyToClipboard).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(data ?? {})).toContain(RULE);
    });

    it('cut() writes the text and removes the rule with it', () => {
        const editor = load('---\n\nab');
        const written = vi.spyOn(DOM.sink, 'writeClipboardText').mockImplementation(() => undefined);

        selectAllOf(editor);
        editor.cut();

        expect(editor.getValue()).toBe('');
        expect(written.mock.calls[0]![0]).toContain('ab');
    });

    it('insertImage over the range leaves the image alone, in a paragraph', () => {
        const editor = load('---\n\nab');

        selectAllOf(editor);
        editor.insertImage('/i.png');

        expect(editor.getValue()).toBe('![](/i.png)');
        expectSaveKeepsDocument(editor, 'insertImage');
    });

    it('a copy of Select All holds the rule', () => {
        const editor = load('---\n\nab');

        selectAllOf(editor);

        const types = lexicalOf(editor).read(() => {
            const selection = $getSelection();

            return $isRangeSelection(selection)
                ? $generateJSONFromSelectedNodes(lexicalOf(editor), selection).nodes.map((node) => node.type)
                : [];
        });

        expect(types).toContain(RULE);
    });
});

// ---------------------------------------------------------------- insertHorizontalRule

/**
 * A step that calls `insertHorizontalRule`.
 *
 * @param at - Where the caret is put first, if anywhere.
 * @param to - The other end of a range.
 * @returns The step.
 */
function insertRule(at?: TextPoint, to?: TextPoint): Step {
    return command((editor) => { editor.insertHorizontalRule(); }, at, to);
}

describe('insertHorizontalRule places a rule as insertTable places a table', () => {
    it.each<[string, string, TextPoint, string, string]>([
        ['at the end of a paragraph', 'ab', ['ab', 2], 'ab\n\n---', '""@0'],
        ['inside a paragraph', 'ab', ['ab', 1], 'a\n\n---\n\nb', '"b"@0'],
        ['at the start of a paragraph', 'ab', ['ab', 0], '---\n\nab', '"ab"@0'],
        ['between two paragraphs', 'ab\n\ncd', ['ab', 2], 'ab\n\n---\n\ncd', '"cd"@0'],
        ['inside a quote', '> ab', ['ab', 1], '> a\n>\n> ---\n>\n> b', '"b"@0'],
        ['at the end of a quote', '> ab', ['ab', 2], '> ab\n>\n> ---', '""@0'],
        ['inside a list item', '- ab\n- z', ['ab', 1], '- a\n\n---\n\n- b\n- z', '"b"@0'],
        ['at the end of a column', '::: columns\nab\n|||\nx\n:::', ['ab', 2], '::: columns\nab\n\n---\n|||\nx\n:::', '""@0'],
        ['inside a heading', '# ab', ['ab', 1], '# a\n\n---\n\n# b', '"b"@0'],
    ])('%s', (_name, source, at, saved, caret) => {
        walk(source, [[insertRule(at), saved, caret]]);
    });

    it('over a range replaces the range, as a typed character does', () => {
        walk('abc\n\ndef', [[insertRule(['abc', 1], ['def', 2]), 'a\n\n---\n\nf', '"f"@0']]);
    });

    it('in an empty document leaves the rule and an empty paragraph after it', () => {
        const editor = load('');

        editor.insertHorizontalRule();

        expect(editor.getValue()).toBe('---');
        expect(selectionOf(editor)).toBe('""@0');
        expectSaveKeepsDocument(editor, 'the rule');
    });

    it('is one undo step', () => {
        walk('ab', [
            [insertRule(['ab', 1]), 'a\n\n---\n\nb'],
            [{ key: 'undo' }, 'ab'],
        ]);
    });

    it('goes after a selected rule, which leaves the caret at the next block', () => {
        const editor = load('a\n\n---\n\nb');

        selectRule(editor);
        editor.insertHorizontalRule();

        expect(editor.getValue()).toBe('a\n\n---\n\n---\n\nb');
        expect(selectionOf(editor)).toBe('"b"@0');
        expectSaveKeepsDocument(editor, 'the rule');
    });

    it.each<[string, string, TextPoint]>([
        ['a table', '| h |\n| --- |\n| c |', ['c', 0]],
        ['a code block', '```\ncode\n```', ['code', 2]],
        ['a raw block', '<div>\nx\n</div>', ['<div>', 2]],
    ])('declines in %s', (_name, source, at) => {
        const editor = load(source);

        selectText(editor, at);

        expect(editor.getSelectionState().canInsertHorizontalRule).toBe(false);
        editor.insertHorizontalRule();

        expect(editor.getValue()).toBe(source);
    });

    it('a read-only editor refuses it, firing readonlyedit once', () => {
        const editor = load('ab');
        const refused = vi.fn();

        editor.on('readonlyedit', refused);
        editor.setReadOnly(true);
        selectText(editor, ['ab', 1]);
        editor.insertHorizontalRule();

        expect(editor.getValue()).toBe('ab');
        expect(refused).toHaveBeenCalledTimes(1);
    });
});

describe('canInsertHorizontalRule follows canInsertTable', () => {
    it.each<[string, string, TextPoint | null]>([
        ['in prose', 'ab', ['ab', 1]],
        ['in a raw block', '<div>\nx\n</div>', ['<div>', 2]],
        ['in a code block', '```\ncode\n```', ['code', 2]],
        ['in a table cell', '| h |\n| --- |\n| c |', ['c', 0]],
        ['with no selection at a document ending in a code block', 'ab\n\n```\ncode\n```', null],
        ['with no selection at a document ending in prose', 'ab\n\ncd', null],
    ])('%s', (_name, source, at) => {
        const editor = load(source);

        if (at !== null) {
            selectText(editor, at);
        }

        const state = editor.getSelectionState();

        expect(state.canInsertHorizontalRule).toBe(state.canInsertTable);
    });

    it('a selected rule leaves the three inserts available, and each puts its block right after the rule', () => {
        const editor = load('a\n\n---\n\nb');

        selectRule(editor);

        const state = editor.getSelectionState();

        expect([state.canInsertTable, state.canInsertImage, state.canInsertHorizontalRule]).toEqual([true, true, true]);
        expect(state.hasSelectedText).toBe(true);

        editor.insertTable(2, 2);

        expect(editor.getValue()).toBe('a\n\n---\n\n|  |  |\n| --- | --- |\n|  |  |\n\nb');

        const imaged = load('a\n\n---\n\nb');

        selectRule(imaged);
        imaged.insertImage('/i.png');

        expect(imaged.getValue()).toBe('a\n\n---\n\n![](/i.png)\n\nb');
    });

    it('a right-click on a selected rule shows the text menu: Cut and Copy have a selection, every format is dimmed', () => {
        const editor = load('a\n\n---\n\nb');

        selectRule(editor);

        const target = lexicalOf(editor).read(() => {
            const rule = $dfs($getRoot()).map(({ node }) => node).find($isMarkdownHorizontalRuleNode)!;

            return $classifyContextMenuTarget(rule);
        });

        expect(target.kind).toBe('text');
        expect(target.hasSelectedText).toBe(true);
        expect(target.availability.canFormat).toBe(false);
        expect(target.availability.canLink).toBe(false);
        expect(target.availability.canSetBlockType).toBe(false);
    });

    it('a selected rule counts as selected text: copy writes its line, cut writes it and removes the rule', () => {
        const writes = vi.spyOn(DOM.sink, 'writeClipboardText').mockImplementation(() => undefined);
        const copied = load('a\n\n---\n\nb');

        selectRule(copied);
        copied.copy();

        expect(writes).toHaveBeenLastCalledWith('---');

        const cut = load('a\n\n***\n\nb');

        selectRule(cut);
        cut.cut();

        expect(writes).toHaveBeenLastCalledWith('***');
        expect(cut.getValue()).toBe('a\n\nb');
    });
});

// ---------------------------------------------------------------- the typing shortcut

describe('three dashes, stars or underscores, then a space or Enter, make a rule', () => {
    it('Enter after dashes makes a rule and leaves the caret in the paragraph after it; one undo gives the paragraph back', () => {
        const editor = load('\\-\\-\\-');

        expect(shapeOf(editor)).toBe('paragraph("---")');

        press(editor, { key: 'Enter', at: ['---', 3] });

        expect(shapeOf(editor)).toBe(`${RULE} | paragraph()`);
        expect(selectionOf(editor)).toBe('""@0');
        expect(editor.getValue()).toBe('---');

        press(editor, { key: 'undo' });

        expect(shapeOf(editor)).toBe('paragraph("---")');
        expect(selectionOf(editor)).toBe('"---"@3');
    });

    it('a longer run makes a rule of that run', () => {
        const editor = load('\\-\\-\\-\\-');

        press(editor, { key: 'type', text: ' ', at: ['----', 4] });

        expect(editor.getValue()).toBe('----');
        expect(shapeOf(editor)).toBe(`${RULE} | paragraph()`);
    });

    it('works in a column', () => {
        const editor = load('::: columns\n\\-\\-\\-\n|||\nx\n:::');

        press(editor, { key: 'type', text: ' ', at: ['---', 3] });

        expect(editor.getValue()).toBe('::: columns\n---\n|||\nx\n:::');
        expect(shapeOf(editor)).toBe(`markdown-block(markdown-column(${RULE}, paragraph()), markdown-column(paragraph("x")))`);
    });

    it.each<[string, string, TextPoint]>([
        ['a heading', '# \\-\\-\\-', ['---', 3]],
        ['an item\'s text', '- \\-\\-\\-', ['---', 3]],
        ['a table cell', '| h |\n| --- |\n| \\-\\-\\- |', ['---', 3]],
    ])('makes no rule in %s: the text stays, with the space', (_name, source, at) => {
        const editor = load(source);

        press(editor, { key: 'type', text: ' ', at });

        expect(shapeOf(editor)).not.toContain(RULE);
        expect(lexicalOf(editor).read(() => $getRoot().getTextContent())).toContain('--- ');
    });

    it('makes no rule of a marker before other text', () => {
        const editor = load('\\-\\-\\-z');

        press(editor, { key: 'type', text: ' ', at: ['---z', 3] });

        expect(shapeOf(editor)).toBe('paragraph("--- z")');
    });
});

// ---------------------------------------------------------------- paste

/** Nodes as Lexical's copy writes them. */
type CopiedNodes = ReturnType<typeof $generateJSONFromSelectedNodes>['nodes'];

/** The clipboard type Lexical writes its copied nodes under. */
const LEXICAL_CLIPBOARD_TYPE = 'application/x-lexical-editor';

/**
 * Copies what the editor's selection holds, as Lexical's copy does.
 *
 * @param editor - The editor.
 * @returns The copied nodes.
 */
function copySelection(editor: MarkdownEditor): CopiedNodes {
    const lexical = lexicalOf(editor);

    return lexical.read(() => $generateJSONFromSelectedNodes(lexical, $getSelection()).nodes);
}

/**
 * Pastes copied nodes at the selection as Ctrl/Cmd+V does: a `PASTE_COMMAND` whose clipboard holds the nodes.
 *
 * @param editor - The editor.
 * @param nodes - The copied nodes.
 */
function pasteNodes(editor: MarkdownEditor, nodes: CopiedNodes): void {
    const data: Record<string, string> = {
        [LEXICAL_CLIPBOARD_TYPE]: JSON.stringify({ namespace: lexicalOf(editor)._config.namespace, nodes }),
    };
    const transfer = { types: Object.keys(data), files: [], getData: (type: string) => data[type] ?? '' } as unknown as DataTransfer;
    const event = Object.assign(new ClipboardEvent('paste'), { clipboardData: transfer, preventDefault: () => {} });

    lexicalOf(editor).update(() => {
        lexicalOf(editor).dispatchCommand(PASTE_COMMAND, event);
    }, { discrete: true });
    settle(editor);
}

/**
 * The nodes of a copied rule.
 *
 * @returns The copied nodes.
 */
function copiedRule(): CopiedNodes {
    const origin = load('a\n\n---\n\nb');

    selectRule(origin);

    return copySelection(origin);
}

describe('a rule pastes where a block goes', () => {
    it.each<[string, string, TextPoint, string]>([
        ['into a paragraph', 'bc', ['bc', 1], 'b\n\n---\n\nc'],
        ['at the end of an item\'s text, leaving no empty item', '- a\n- b', ['a', 1], '- a\n\n  ---\n\n- b'],
        ['inside an item\'s text, keeping the rest an item', '- ab\n- z', ['ab', 1], '- a\n\n  ---\n\n- b\n\n- z'],
        ['at the end of a quote\'s paragraph', '> a', ['a', 1], '> a\n>\n> ---'],
    ])('%s', (_name, source, at, saved) => {
        const editor = load(source);

        selectText(editor, at);
        pasteNodes(editor, copiedRule());

        expect(editor.getValue()).toBe(saved);
        expectSaveKeepsDocument(editor, 'the paste');
    });

    it('into a table cell is dropped', () => {
        const source = '| h |\n| --- |\n| c |';
        const editor = load(source);

        selectText(editor, ['c', 1]);
        pasteNodes(editor, copiedRule());

        expect(editor.getValue()).toBe(source);
        expectSaveKeepsDocument(editor, 'the paste');
    });

    it('a copied range holding a rule pastes it', () => {
        const origin = load('x\n\n---\n\ny');

        selectText(origin, ['x', 0], ['y', 1]);

        const nodes = copySelection(origin);
        const editor = load('- a\n- b');

        selectText(editor, ['a', 1]);
        pasteNodes(editor, nodes);

        expect(editor.getValue()).toBe('- ax\n\n  ---\n\n  y\n\n- b');
        expectSaveKeepsDocument(editor, 'the paste');
    });
});

// ---------------------------------------------------------------- the inserts while a rule is selected

/** What stands around the first rule of a document: its parent and its next sibling, by key. */
interface RuleSurroundings {
    readonly parent:     string;
    readonly parentType: string;
    readonly next:       string | null;
    readonly nextType:   string | null;
}

/**
 * Reads what stands around the document's first rule.
 *
 * @param editor - The editor.
 * @returns Its parent and next sibling.
 */
function surroundingsOfRule(editor: MarkdownEditor): RuleSurroundings {
    return lexicalOf(editor).read(() => {
        const rule = $dfs($getRoot()).map(({ node }) => node).find($isMarkdownHorizontalRuleNode)!;
        const next = rule.getNextSibling();

        return {
            parent:     rule.getParentOrThrow().getKey(),
            parentType: rule.getParentOrThrow().getType(),
            next:       next === null ? null : next.getKey(),
            nextType:   next === null ? null : next.getType(),
        };
    });
}

/**
 * Prefixes each line of a text.
 *
 * @param text - The text.
 * @param first - The prefix of the first line.
 * @param rest - The prefix of every other line (a blank line gets its trimmed end).
 * @returns The prefixed text.
 */
function prefixLines(text: string, first: string, rest: string): string {
    return text.split('\n').map((line, index) => (index === 0 ? first : rest) + line).map((line) => line.trimEnd() === '' ? line.trimEnd() : line).join('\n');
}

/** What can follow a rule, by name. */
const FOLLOWERS: ReadonlyArray<readonly [string, string]> = [
    ['a paragraph', 'p'],
    ['a table', '| h |\n| --- |\n| c |'],
    ['a list', '- x'],
    ['a quote', '> q'],
    ['a `:::` block', '::: columns\nc\n|||\nd\n:::'],
    ['a code block', '```\ncode\n```'],
    ['a raw block', '<div>x</div>'],
];

/** Where a rule can stand, as a function from what follows it to a document. */
const RULE_PLACES: ReadonlyArray<readonly [string, (follower: string) => string]> = [
    ['at the top level', (follower) => `a\n\n---\n\n${follower}`],
    ['in a list item', (follower) => `- a\n\n  ---\n\n${prefixLines(follower, '  ', '  ')}`],
    ['in a quote', (follower) => `> a\n>\n> ---\n>\n${prefixLines(follower, '> ', '> ')}`],
    ['in a column', (follower) => `::: columns\n---\n\n${follower}\n|||\nz\n:::`],
];

/** Where a rule can stand with nothing after it in its parent. */
const RULE_ENDS: ReadonlyArray<readonly [string, string]> = [
    ['at the end of the document', 'a\n\n---'],
    ['at the end of a list item', '- a\n\n  ---\n- b'],
    ['at the end of a quote', '> a\n>\n> ---'],
    ['at the end of a column', '::: columns\na\n\n---\n|||\nz\n:::'],
];

/** The three inserts: a name, the call, the type of the block it adds, and where its caret lands. */
const INSERTS: ReadonlyArray<readonly [string, (editor: MarkdownEditor) => void, string]> = [
    ['insertTable', (editor) => { editor.insertTable(2, 2); }, 'table'],
    ['insertHorizontalRule', (editor) => { editor.insertHorizontalRule(); }, RULE],
    ['insertImage', (editor) => { editor.insertImage('/i.png'); }, 'paragraph'],
];

/**
 * Whether the selection's anchor lies in a node, or is the node.
 *
 * @param editor - The editor.
 * @param key - The node's key.
 * @returns `true` when it does.
 */
function caretIsIn(editor: MarkdownEditor, key: string): boolean {
    return lexicalOf(editor).read(() => {
        const selection = $getSelection();
        const node = $getNodeByKey(key);

        return $isRangeSelection(selection) && node !== null
            && (selection.anchor.getNode().is(node) || ($isElementNode(node) && node.isParentOf(selection.anchor.getNode())));
    });
}

describe('with a rule selected, each insert puts its block right after the rule, in the rule\'s own parent', () => {
    const CASES = INSERTS.flatMap(([name, run, added]) => [
        ...RULE_PLACES.flatMap(([place, build]) => FOLLOWERS.map(([follower, source]) => [name, run, added, `${place}, before ${follower}`, build(source)] as const)),
        ...RULE_ENDS.map(([place, source]) => [name, run, added, place, source] as const),
    ]);

    it.each(CASES)('%s, rule %s', (_name, run, added, _where, source) => {
        const editor = load(source);
        const before = surroundingsOfRule(editor);

        expect(before.parentType, 'the rule loaded where the row means it').not.toBe('paragraph');
        selectRule(editor);
        run(editor);
        settle(editor);

        const after = lexicalOf(editor).read(() => {
            const rule = $dfs($getRoot()).map(({ node }) => node).find($isMarkdownHorizontalRuleNode)!;
            const block = rule.getNextSibling()!;
            const following = block.getNextSibling();

            return {
                parent:        rule.getParentOrThrow().getKey(),
                addedType:     block.getType(),
                holdsImage:    $isElementNode(block) && block.getChildren().some((child) => child.getType() === 'markdown-image'),
                addedKey:      block.getKey(),
                followingKey:  following === null ? null : following.getKey(),
                followingType: following === null ? null : following.getType(),
                followingText: following === null ? null : following.getTextContent(),
            };
        });

        expect(after.parent, 'the rule keeps its parent').toBe(before.parent);
        expect(after.addedType).toBe(added);

        if (added === 'paragraph') {
            expect(after.holdsImage, 'the paragraph holds the image').toBe(true);
        }

        if (before.next !== null) {
            expect(after.followingKey, 'what followed the rule follows the new block, untouched').toBe(before.next);
        } else if (added !== 'paragraph') {
            expect(after.followingType, 'a block that ends its container is followed by an empty paragraph').toBe('paragraph');
            expect(after.followingText).toBe('');
        } else {
            expect(after.followingKey).toBeNull();
        }

        expect(caretIsIn(editor, after.addedKey) || after.addedType === RULE, 'the caret lands as the insert leaves it').toBe(true);
        expectSaveKeepsDocument(editor, 'the insert');
    });
});

describe('the caret an insert leaves with a rule selected', () => {
    it('is in the first header cell after insertTable', () => {
        const editor = load('a\n\n---\n\nb');

        selectRule(editor);
        editor.insertTable(2, 2);

        const inFirstCell = lexicalOf(editor).read(() => {
            const selection = $getSelection();
            const table = $dfs($getRoot()).map(({ node }) => node).find((node) => node.getType() === 'table')!;

            return $isRangeSelection(selection) && $isElementNode(table) && table.isParentOf(selection.anchor.getNode());
        });

        expect(inFirstCell).toBe(true);
    });

    it('starts the block after the new rule after insertHorizontalRule', () => {
        const editor = load('a\n\n---\n\nb');

        selectRule(editor);
        editor.insertHorizontalRule();

        expect(selectionOf(editor)).toBe('"b"@0');
    });

    it('is after the image after insertImage', () => {
        const editor = load('a\n\n---\n\nb');

        selectRule(editor);
        editor.insertImage('/i.png');

        expect(selectionOf(editor)).toBe('""@0');
    });
});

// ---------------------------------------------------------------- the block commands next to a rule

describe('the block commands leave a rule where it stands', () => {
    it('toggleUnorderedList over the blocks around a rule', () => {
        walk('a\n\n---\n\nb', [[command((editor) => { editor.toggleUnorderedList(); }, ['a', 0], ['b', 1]), '- a\n\n---\n\n- b']]);
    });

    it.each<[MarkdownBlockType, string]>([
        ['h2', '## a\n\n---\n\n## b'],
        ['quote', '> a\n\n---\n\n> b'],
        ['code', '```\na\n```\n\n---\n\n```\nb\n```'],
    ])('setBlockType %s over the blocks around a rule', (type, saved) => {
        walk('a\n\n---\n\nb', [[blockType(type, ['a', 0], ['b', 1]), saved]]);
    });

    it('the list toggle that takes an item out of its list carries the rule out with it', () => {
        walk('- a\n\n  ---\n\n  b', [[command((editor) => { editor.toggleUnorderedList(); }, ['a', 0]), 'a\n\n---\n\nb']]);
    });
});

// ---------------------------------------------------------------- Backspace beside a rule in a list

describe('Backspace beside a rule that ends or opens an item', () => {
    it('at the start of the next item removes the rule that opens the item before it', () => {
        walk('- ***\n- b', [[{ key: 'Backspace', at: ['b', 0] }, '-\n- b']]);
    });

    it('in an empty item after a list ending with a rule removes the item and selects the rule', () => {
        const editor = walk('- a\n\n  ---\n- b', [
            [{ key: 'Backspace', at: ['b', 0], to: ['b', 1] }, '- a\n\n  ---\n\n-'],
            [{ key: 'Backspace' }, '- a\n\n  ---', 'node[rule]'],
        ]);

        expect(editor.getValue()).toBe('- a\n\n  ---');
    });
});

// ---------------------------------------------------------------- the selected look and the undo history

describe('marking a rule selected leaves the undo history to the edit made in the same tick', () => {
    /** A keyboard event stand-in that records whether it was cancelled. */
    function cancellableEvent(): KeyboardEvent & { defaultPrevented: boolean } {
        const event = { defaultPrevented: false, shiftKey: false, target: null, stopPropagation: () => {} } as unknown as KeyboardEvent & { defaultPrevented: boolean };

        event.preventDefault = () => { (event as { defaultPrevented: boolean }).defaultPrevented = true; };

        return event;
    }

    it('selecting a rule and pressing Delete in one tick: one undo brings the rule back', () => {
        const editor = load('a\n\n---\n\nb');
        const lexical = lexicalOf(editor);

        lexical.update(() => {
            const rule = $dfs($getRoot()).map(({ node }) => node).find($isMarkdownHorizontalRuleNode)!;
            const selection = $createNodeSelection();

            selection.add(rule.getKey());
            $setSelection(selection);
        });
        lexical.dispatchCommand(KEY_DELETE_COMMAND, cancellableEvent());
        settle(editor);

        expect(editor.getValue()).toBe('a\n\nb');

        lexical.dispatchCommand(UNDO_COMMAND, undefined);
        settle(editor);

        expect(editor.getValue()).toBe('a\n\n---\n\nb');
    });

    it('selecting a rule, moving to b and typing Z in one tick: one undo takes the Z back', () => {
        const editor = load('a\n\n---\n\nb');
        const lexical = lexicalOf(editor);

        lexical.update(() => {
            const rule = $dfs($getRoot()).map(({ node }) => node).find($isMarkdownHorizontalRuleNode)!;
            const selection = $createNodeSelection();

            selection.add(rule.getKey());
            $setSelection(selection);
        });
        lexical.update(() => {
            const selection = $createRangeSelection();

            selection.anchor.set($textNode('b').getKey(), 1, 'text');
            selection.focus.set($textNode('b').getKey(), 1, 'text');
            $setSelection(selection);
        });
        lexical.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'Z');
        settle(editor);

        expect(editor.getValue()).toBe('a\n\n---\n\nbZ');

        lexical.dispatchCommand(UNDO_COMMAND, undefined);
        settle(editor);

        expect(editor.getValue()).toBe('a\n\n---\n\nb');
    });

    it.each<[string, string, number, number, string]>([
        ['Select All over a lone rule', '---', 0, 1, ''],
        ['the range from before the middle rule to after it', 'a\n\n---\n\nb', 1, 2, 'a\n\nb'],
        ['the range over the first of two adjacent rules', 'a\n\n***\n\n---\n\nb', 1, 2, 'a\n\n---\n\nb'],
        ['the range over the middle of three adjacent rules', 'a\n\n***\n\n---\n\n___\n\nb', 2, 3, 'a\n\n***\n\n___\n\nb'],
    ])('the keys that delete cancel the browser\'s own deletion and remove only the rules in the range: %s', (_name, source, from, to, saved) => {
        for (const [commandName, key] of [['Backspace', KEY_BACKSPACE_COMMAND], ['Delete', KEY_DELETE_COMMAND]] as const) {
            const editor = load(source);

            lexicalOf(editor).update(() => {
                const selection = $createRangeSelection();

                selection.anchor.set($getRoot().getKey(), from, 'element');
                selection.focus.set($getRoot().getKey(), to, 'element');
                $setSelection(selection);
            }, { discrete: true });

            const event = cancellableEvent();

            lexicalOf(editor).dispatchCommand(key, event);
            settle(editor);

            expect(event.defaultPrevented, `${commandName} is cancelled`).toBe(true);
            expect(editor.getValue(), commandName).toBe(saved);
        }
    });
});

// ---------------------------------------------------------------- the typing shortcut needs the marker alone

describe('the horizontal rule shortcut applies only to a paragraph that holds nothing but the marker', () => {
    it.each<[string, string]>([
        ['bold', '\\-\\-\\-**z**'],
        ['a link', '\\-\\-\\-[t](u)'],
        ['an image', '\\-\\-\\-![i](/i.png)'],
        ['a hard break', '\\-\\-\\-\\\nz'],
    ])('makes no rule when %s follows the marker', (_name, source) => {
        const editor = load(source);

        press(editor, { key: 'type', text: ' ', at: ['---', 3] });

        expect(shapeOf(editor)).not.toContain(RULE);
    });
});

// ---------------------------------------------------------------- a range over one rule among adjacent rules

/** Each place a run of adjacent rules stands, as a function of the run (rules written `***`, `---`, `___`). */
const ADJACENT_PLACES: Readonly<Record<string, (rules: string) => string>> = {
    top:    (rules) => `a\n\n${rules}\n\nb`,
    item:   (rules) => `- a\n\n${prefixLines(rules, '  ', '  ')}\n\n  b`,
    quote:  (rules) => `> a\n>\n${rules.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n')}\n>\n> b`,
    column: (rules) => `::: columns\na\n\n${rules}\n\nb\n|||\nz\n:::`,
};

/** Two adjacent rules with the first selected, and three with the middle one selected. */
const ADJACENT_RUNS: Readonly<Record<string, readonly [rules: string, selected: number]>> = {
    two:   ['***\n\n---', 0],
    three: ['***\n\n---\n\n___', 1],
};

/**
 * Selects exactly one rule, as the range between the two points of its parent on either side of it.
 *
 * @param editor - The editor.
 * @param nth - Which rule, in document order.
 */
function selectRangeOverRule(editor: MarkdownEditor, nth: number): void {
    lexicalOf(editor).update(() => {
        const rule = $dfs($getRoot()).map(({ node }) => node).filter($isMarkdownHorizontalRuleNode)[nth]!;
        const parent = rule.getParentOrThrow();
        const selection = $createRangeSelection();

        selection.anchor.set(parent.getKey(), rule.getIndexWithinParent(), 'element');
        selection.focus.set(parent.getKey(), rule.getIndexWithinParent() + 1, 'element');
        $setSelection(selection);
    }, { discrete: true });
}

/** The routes that remove or replace a range, each as what it does to an editor with the range selected. */
const RANGE_ROUTES: Readonly<Record<string, (editor: MarkdownEditor) => Promise<void> | void>> = {
    'Delete':               (editor) => { lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, false); },
    'Backspace':            (editor) => { lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true); },
    'key Delete':           (editor) => { lexicalOf(editor).dispatchCommand(KEY_DELETE_COMMAND, cancellableKey()); },
    'key Backspace':        (editor) => { lexicalOf(editor).dispatchCommand(KEY_BACKSPACE_COMMAND, cancellableKey()); },
    'type':                 (editor) => { lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'Z'); },
    'Enter':                (editor) => { lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null); },
    'paste':                (editor) => {
        const data: Record<string, string> = { 'text/plain': 'Q' };
        const transfer = { types: ['text/plain'], files: [], getData: (type: string) => data[type] ?? '' } as unknown as DataTransfer;
        const event = Object.assign(new ClipboardEvent('paste'), { clipboardData: transfer, preventDefault: () => {} });

        lexicalOf(editor).update(() => { lexicalOf(editor).dispatchCommand(PASTE_COMMAND, event); }, { discrete: true });
    },
    'cut':                  async (editor) => {
        lexicalOf(editor).dispatchCommand(CUT_COMMAND, null);
        await vi.waitFor(() => expect(copyToClipboard).toHaveBeenCalled());
        await Promise.resolve();
    },
    'insertTable':          (editor) => { editor.insertTable(2, 2); },
    'insertHorizontalRule': (editor) => { editor.insertHorizontalRule(); },
    'insertImage':          (editor) => { editor.insertImage('/i.png'); },
};

/**
 * A key event stand-in that records whether it was cancelled.
 *
 * @returns The event.
 */
function cancellableKey(): KeyboardEvent {
    const event = { defaultPrevented: false, shiftKey: false, target: null, stopPropagation: () => {} } as unknown as KeyboardEvent & { defaultPrevented: boolean };

    event.preventDefault = () => { (event as { defaultPrevented: boolean }).defaultPrevented = true; };

    return event;
}

/**
 * Every route, for every run of adjacent rules and every place: [place, run, route, the save after it, and for a cut the
 * line of the one rule it copied]. Only the rule in the range is removed or replaced; the rules beside it stay. A
 * deletion removes that rule alone, typing, pasting and an image replace it, and Enter leaves the empty paragraph it
 * opens, which saves nothing. `insertTable` keeps the content of the range it is given, so it adds its table after the
 * selected rule, which stays. In a list item the two block inserts split the list around the new block, as they do
 * from a caret there.
 */
const ADJACENT_RULE_ROWS: ReadonlyArray<readonly [place: string, run: string, route: string, saved: string, copied: string | null]> = [
    ["top", "two", "Delete", "a\n\n---\n\nb", null],
    ["top", "two", "Backspace", "a\n\n---\n\nb", null],
    ["top", "two", "key Delete", "a\n\n---\n\nb", null],
    ["top", "two", "key Backspace", "a\n\n---\n\nb", null],
    ["top", "two", "type", "a\n\nZ\n\n---\n\nb", null],
    ["top", "two", "Enter", "a\n\n---\n\nb", null],
    ["top", "two", "paste", "a\n\nQ\n\n---\n\nb", null],
    ["top", "two", "cut", "a\n\n---\n\nb", "***"],
    ["top", "two", "insertTable", "a\n\n***\n\n|  |  |\n| --- | --- |\n|  |  |\n\n---\n\nb", null],
    ["top", "two", "insertHorizontalRule", "a\n\n---\n\n---\n\nb", null],
    ["top", "two", "insertImage", "a\n\n![](/i.png)\n\n---\n\nb", null],
    ["top", "three", "Delete", "a\n\n***\n\n___\n\nb", null],
    ["top", "three", "Backspace", "a\n\n***\n\n___\n\nb", null],
    ["top", "three", "key Delete", "a\n\n***\n\n___\n\nb", null],
    ["top", "three", "key Backspace", "a\n\n***\n\n___\n\nb", null],
    ["top", "three", "type", "a\n\n***\n\nZ\n\n___\n\nb", null],
    ["top", "three", "Enter", "a\n\n***\n\n___\n\nb", null],
    ["top", "three", "paste", "a\n\n***\n\nQ\n\n___\n\nb", null],
    ["top", "three", "cut", "a\n\n***\n\n___\n\nb", "---"],
    ["top", "three", "insertTable", "a\n\n***\n\n---\n\n|  |  |\n| --- | --- |\n|  |  |\n\n___\n\nb", null],
    ["top", "three", "insertHorizontalRule", "a\n\n***\n\n---\n\n___\n\nb", null],
    ["top", "three", "insertImage", "a\n\n***\n\n![](/i.png)\n\n___\n\nb", null],
    ["item", "two", "Delete", "- a\n\n  ---\n\n  b", null],
    ["item", "two", "Backspace", "- a\n\n  ---\n\n  b", null],
    ["item", "two", "key Delete", "- a\n\n  ---\n\n  b", null],
    ["item", "two", "key Backspace", "- a\n\n  ---\n\n  b", null],
    ["item", "two", "type", "- a\n\n  Z\n\n  ---\n\n  b", null],
    ["item", "two", "Enter", "- a\n\n  ---\n\n  b", null],
    ["item", "two", "paste", "- a\n\n  Q\n\n  ---\n\n  b", null],
    ["item", "two", "cut", "- a\n\n  ---\n\n  b", "***"],
    ["item", "two", "insertTable", "- a\n\n  ***\n\n|  |  |\n| --- | --- |\n|  |  |\n\n-\n  ---\n\n  b", null],
    ["item", "two", "insertHorizontalRule", "- a\n\n---\n\n-\n  ---\n\n  b", null],
    ["item", "two", "insertImage", "- a\n\n  ![](/i.png)\n\n  ---\n\n  b", null],
    ["item", "three", "Delete", "- a\n\n  ***\n\n  ___\n\n  b", null],
    ["item", "three", "Backspace", "- a\n\n  ***\n\n  ___\n\n  b", null],
    ["item", "three", "key Delete", "- a\n\n  ***\n\n  ___\n\n  b", null],
    ["item", "three", "key Backspace", "- a\n\n  ***\n\n  ___\n\n  b", null],
    ["item", "three", "type", "- a\n\n  ***\n\n  Z\n\n  ___\n\n  b", null],
    ["item", "three", "Enter", "- a\n\n  ***\n\n  ___\n\n  b", null],
    ["item", "three", "paste", "- a\n\n  ***\n\n  Q\n\n  ___\n\n  b", null],
    ["item", "three", "cut", "- a\n\n  ***\n\n  ___\n\n  b", "---"],
    ["item", "three", "insertTable", "- a\n\n  ***\n\n  ---\n\n|  |  |\n| --- | --- |\n|  |  |\n\n- ___\n\n  b", null],
    ["item", "three", "insertHorizontalRule", "- a\n\n  ***\n\n---\n\n- ___\n\n  b", null],
    ["item", "three", "insertImage", "- a\n\n  ***\n\n  ![](/i.png)\n\n  ___\n\n  b", null],
    ["quote", "two", "Delete", "> a\n>\n> ---\n>\n> b", null],
    ["quote", "two", "Backspace", "> a\n>\n> ---\n>\n> b", null],
    ["quote", "two", "key Delete", "> a\n>\n> ---\n>\n> b", null],
    ["quote", "two", "key Backspace", "> a\n>\n> ---\n>\n> b", null],
    ["quote", "two", "type", "> a\n>\n> Z\n>\n> ---\n>\n> b", null],
    ["quote", "two", "Enter", "> a\n>\n> ---\n>\n> b", null],
    ["quote", "two", "paste", "> a\n>\n> Q\n>\n> ---\n>\n> b", null],
    ["quote", "two", "cut", "> a\n>\n> ---\n>\n> b", "***"],
    ["quote", "two", "insertTable", "> a\n>\n> ***\n>\n> |  |  |\n> | --- | --- |\n> |  |  |\n>\n> ---\n>\n> b", null],
    ["quote", "two", "insertHorizontalRule", "> a\n>\n> ---\n>\n> ---\n>\n> b", null],
    ["quote", "two", "insertImage", "> a\n>\n> ![](/i.png)\n>\n> ---\n>\n> b", null],
    ["quote", "three", "Delete", "> a\n>\n> ***\n>\n> ___\n>\n> b", null],
    ["quote", "three", "Backspace", "> a\n>\n> ***\n>\n> ___\n>\n> b", null],
    ["quote", "three", "key Delete", "> a\n>\n> ***\n>\n> ___\n>\n> b", null],
    ["quote", "three", "key Backspace", "> a\n>\n> ***\n>\n> ___\n>\n> b", null],
    ["quote", "three", "type", "> a\n>\n> ***\n>\n> Z\n>\n> ___\n>\n> b", null],
    ["quote", "three", "Enter", "> a\n>\n> ***\n>\n> ___\n>\n> b", null],
    ["quote", "three", "paste", "> a\n>\n> ***\n>\n> Q\n>\n> ___\n>\n> b", null],
    ["quote", "three", "cut", "> a\n>\n> ***\n>\n> ___\n>\n> b", "---"],
    ["quote", "three", "insertTable", "> a\n>\n> ***\n>\n> ---\n>\n> |  |  |\n> | --- | --- |\n> |  |  |\n>\n> ___\n>\n> b", null],
    ["quote", "three", "insertHorizontalRule", "> a\n>\n> ***\n>\n> ---\n>\n> ___\n>\n> b", null],
    ["quote", "three", "insertImage", "> a\n>\n> ***\n>\n> ![](/i.png)\n>\n> ___\n>\n> b", null],
    ["column", "two", "Delete", "::: columns\na\n\n---\n\nb\n|||\nz\n:::", null],
    ["column", "two", "Backspace", "::: columns\na\n\n---\n\nb\n|||\nz\n:::", null],
    ["column", "two", "key Delete", "::: columns\na\n\n---\n\nb\n|||\nz\n:::", null],
    ["column", "two", "key Backspace", "::: columns\na\n\n---\n\nb\n|||\nz\n:::", null],
    ["column", "two", "type", "::: columns\na\n\nZ\n\n---\n\nb\n|||\nz\n:::", null],
    ["column", "two", "Enter", "::: columns\na\n\n---\n\nb\n|||\nz\n:::", null],
    ["column", "two", "paste", "::: columns\na\n\nQ\n\n---\n\nb\n|||\nz\n:::", null],
    ["column", "two", "cut", "::: columns\na\n\n---\n\nb\n|||\nz\n:::", "***"],
    ["column", "two", "insertTable", "::: columns\na\n\n***\n\n|  |  |\n| --- | --- |\n|  |  |\n\n---\n\nb\n|||\nz\n:::", null],
    ["column", "two", "insertHorizontalRule", "::: columns\na\n\n---\n\n---\n\nb\n|||\nz\n:::", null],
    ["column", "two", "insertImage", "::: columns\na\n\n![](/i.png)\n\n---\n\nb\n|||\nz\n:::", null],
    ["column", "three", "Delete", "::: columns\na\n\n***\n\n___\n\nb\n|||\nz\n:::", null],
    ["column", "three", "Backspace", "::: columns\na\n\n***\n\n___\n\nb\n|||\nz\n:::", null],
    ["column", "three", "key Delete", "::: columns\na\n\n***\n\n___\n\nb\n|||\nz\n:::", null],
    ["column", "three", "key Backspace", "::: columns\na\n\n***\n\n___\n\nb\n|||\nz\n:::", null],
    ["column", "three", "type", "::: columns\na\n\n***\n\nZ\n\n___\n\nb\n|||\nz\n:::", null],
    ["column", "three", "Enter", "::: columns\na\n\n***\n\n___\n\nb\n|||\nz\n:::", null],
    ["column", "three", "paste", "::: columns\na\n\n***\n\nQ\n\n___\n\nb\n|||\nz\n:::", null],
    ["column", "three", "cut", "::: columns\na\n\n***\n\n___\n\nb\n|||\nz\n:::", "---"],
    ["column", "three", "insertTable", "::: columns\na\n\n***\n\n---\n\n|  |  |\n| --- | --- |\n|  |  |\n\n___\n\nb\n|||\nz\n:::", null],
    ["column", "three", "insertHorizontalRule", "::: columns\na\n\n***\n\n---\n\n___\n\nb\n|||\nz\n:::", null],
    ["column", "three", "insertImage", "::: columns\na\n\n***\n\n![](/i.png)\n\n___\n\nb\n|||\nz\n:::", null],
];

describe('a range over one rule among adjacent rules removes that rule and no other', () => {
    it.each(ADJACENT_RULE_ROWS)('%s, %s rules: %s', async (place, run, route, saved, copied) => {
        vi.mocked(copyToClipboard).mockClear();

        const [rules, selected] = ADJACENT_RUNS[run]!;
        const editor = load(ADJACENT_PLACES[place]!(rules));

        selectRangeOverRule(editor, selected);
        await RANGE_ROUTES[route]!(editor);
        settle(editor);

        expect(editor.getValue()).toBe(saved);

        if (copied !== null) {
            const data = vi.mocked(copyToClipboard).mock.calls[0]![2] as { 'application/x-lexical-editor': string };
            const nodes = (JSON.parse(data['application/x-lexical-editor']) as { nodes: Array<{ type: string; $?: { mdHorizontalRule?: string } }> }).nodes;

            expect(nodes.map((node) => [node.type, node.$?.mdHorizontalRule])).toEqual([[RULE, copied]]);
        }

        expectSaveKeepsDocument(editor, route);
    });

    it('covers every route for every place and run', () => {
        expect(ADJACENT_RULE_ROWS).toHaveLength(Object.keys(ADJACENT_PLACES).length * Object.keys(ADJACENT_RUNS).length * Object.keys(RANGE_ROUTES).length);
    });

    it('Select All over three adjacent rules and nothing else empties the document', () => {
        const editor = load('***\n\n---\n\n___');

        selectAllOf(editor);
        press(editor, { key: 'Delete' });

        expect(editor.getValue()).toBe('');
    });
});

// ---------------------------------------------------------------- word and line deletes beside a rule

describe('Ctrl/Cmd+Backspace and Delete and the line deletes beside a list or quote ending or opening with a rule', () => {
    it.each<[string, string, TextPoint, boolean, string]>([
        ['a list ending with a rule, backward', '- a\n\n  ---\n\nb', ['b', 0], true, '- a\n\nb'],
        ['a quote ending with a rule, backward', '> a\n>\n> ---\n\nb', ['b', 0], true, '> a\n\nb'],
        ['a `:::` block ending with a rule, backward', '::: columns\na\n|||\n---\n:::\n\nb', ['b', 0], true, '::: columns\na\n|||\n---\n:::\n\nb'],
        ['a list opening with a rule, forward', 'a\n\n- ***\n- b', ['a', 1], false, 'a\n\n-\n- b'],
        ['a quote opening with a rule, forward', 'a\n\n> ---\n>\n> b', ['a', 1], false, 'a\n\n> b'],
        ['a `:::` block opening with a rule, forward', 'a\n\n::: columns\n---\n|||\nx\n:::', ['a', 1], false, 'a\n\n::: columns\n---\n|||\nx\n:::'],
    ])('%s: the word and the line delete do what the character delete does', (_name, source, at, backward, saved) => {
        for (const deleting of [DELETE_CHARACTER_COMMAND, DELETE_WORD_COMMAND, DELETE_LINE_COMMAND]) {
            const editor = load(source);

            selectText(editor, at);
            lexicalOf(editor).dispatchCommand(deleting, backward);
            settle(editor);

            expect(editor.getValue()).toBe(saved);
            expectSaveKeepsDocument(editor, 'the delete');
        }
    });

    it('the caret stays outside the list: typing Z afterwards goes into the paragraph', () => {
        for (const deleting of [DELETE_WORD_COMMAND, DELETE_LINE_COMMAND]) {
            const editor = load('- a\n\n  ---\n\nb');

            selectText(editor, ['b', 0]);
            lexicalOf(editor).dispatchCommand(deleting, true);
            press(editor, { key: 'type', text: 'Z' });

            expect(editor.getValue()).toBe('- a\n\nZb');
        }
    });
});

// ---------------------------------------------------------------- a link over a range that crosses a rule

describe('a link over a range that crosses a rule links the text of each block and leaves the rule', () => {
    const URL = 'https://x.test';

    /**
     * How many rules a document holds.
     *
     * @param editor - The editor.
     * @returns The count.
     */
    function ruleCount(editor: MarkdownEditor): number {
        return lexicalOf(editor).read(() => $dfs($getRoot()).map(({ node }) => node).filter($isMarkdownHorizontalRuleNode).length);
    }

    it.each<[string, string, TextPoint, TextPoint, string]>([
        ['at the top level', 'a\n\n---\n\nb', ['a', 0], ['b', 1], `[a](${URL})\n\n---\n\n[b](${URL})`],
        ['in a list item', '- a\n\n  ---\n\n  b', ['a', 0], ['b', 1], `- [a](${URL})\n\n  ---\n\n  [b](${URL})`],
        ['in a quote', '> a\n>\n> ---\n>\n> b', ['a', 0], ['b', 1], `> [a](${URL})\n>\n> ---\n>\n> [b](${URL})`],
        ['in a column', '::: columns\na\n\n---\n\nb\n|||\nx\n:::', ['a', 0], ['b', 1], `::: columns\n[a](${URL})\n\n---\n\n[b](${URL})\n|||\nx\n:::`],
        ['over part of each block', 'abc\n\n---\n\ndef', ['abc', 1], ['def', 2], `a[bc](${URL})\n\n---\n\n[de](${URL})f`],
        ['over two adjacent rules', 'a\n\n***\n\n---\n\nb', ['a', 0], ['b', 1], `[a](${URL})\n\n***\n\n---\n\n[b](${URL})`],
    ])('%s', (_name, source, from, to, saved) => {
        const editor = load(source);
        const rules = ruleCount(editor);

        selectText(editor, from, to);
        editor.toggleLink(URL);

        expect(editor.getValue()).toBe(saved);
        expect(ruleCount(editor)).toBe(rules);
        expectSaveKeepsDocument(editor, 'the link');
    });

    it('removeLink and toggleLink(null) over the same range unlink the text and leave the rule', () => {
        const linked = `[a](${URL})\n\n---\n\n[b](${URL})`;
        const unlinked = load(linked);

        selectText(unlinked, ['a', 0], ['b', 1]);
        unlinked.toggleLink(null);

        expect(unlinked.getValue()).toBe('a\n\n---\n\nb');
        expect(ruleCount(unlinked)).toBe(1);

        const removed = load(linked);

        selectText(removed, ['a', 0]);
        removed.removeLink();

        expect(removed.getValue()).toBe(`a\n\n---\n\n[b](${URL})`);
        expect(ruleCount(removed)).toBe(1);
    });

    it('a text style over the same range styles the text of each block and leaves the rule', () => {
        const editor = load('a\n\n---\n\nb');

        selectText(editor, ['a', 0], ['b', 1]);
        editor.setTextColor('#ff0000');

        expect(editor.getValue()).toBe('[a]{color=#ff0000}\n\n---\n\n[b]{color=#ff0000}');
        expect(ruleCount(editor)).toBe(1);
    });
});

// ---------------------------------------------------------------- a command that changes nothing leaves the rules at the range's ends

describe('a command that changes nothing leaves a range with a rule at an end as it is', () => {
    /**
     * The anchor and the focus of the selection, as keys and offsets.
     *
     * @param editor - The editor.
     * @returns A description of the two points.
     */
    function pointsOf(editor: MarkdownEditor): string {
        return lexicalOf(editor).read(() => {
            const selection = $getSelection();

            return $isRangeSelection(selection)
                ? `${selection.anchor.key}:${selection.anchor.offset}:${selection.anchor.type}-${selection.focus.key}:${selection.focus.offset}:${selection.focus.type}`
                : 'not a range';
        });
    }

    /**
     * Dispatches a paste whose clipboard is described.
     *
     * @param editor - The editor.
     * @param types - The clipboard's types.
     * @param files - Its files.
     * @param data - Its data by type.
     */
    function paste(editor: MarkdownEditor, types: string[], files: unknown[], data: Record<string, string>): void {
        const transfer = { types, files, getData: (type: string) => data[type] ?? '' } as unknown as DataTransfer;
        const event = Object.assign(new ClipboardEvent('paste'), { clipboardData: transfer, preventDefault: () => {} });

        lexicalOf(editor).update(() => { lexicalOf(editor).dispatchCommand(PASTE_COMMAND, event); }, { discrete: true });
        settle(editor);
    }

    const NOTHING: ReadonlyArray<readonly [string, (editor: MarkdownEditor) => void]> = [
        ['an empty clipboard', (editor) => paste(editor, [], [], {})],
        ['a file alone', (editor) => paste(editor, ['Files'], [{}], {})],
        ['a paste of no nodes', (editor) => paste(editor, ['application/x-lexical-editor'], [], {
            'application/x-lexical-editor': JSON.stringify({ namespace: 'none', nodes: [] }),
        })],
        ['Shift+Enter', (editor) => { lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false); settle(editor); }],
    ];

    it.each(['---\n\nab', 'ab\n\n---', '<div></div>\n\nab', 'ab\n\n<div></div>'].flatMap((source) => NOTHING.map(([name, run]) => [source, name, run] as const)))(
        'Select All over %j, then %s: the document and the selection stay', (source, _name, run) => {
            const editor = load(source);

            selectAllOf(editor);

            const before = pointsOf(editor);

            run(editor);

            expect(editor.getValue()).toBe(source);
            expect(pointsOf(editor)).toBe(before);
        },
    );

    it('a paste that carries text still replaces the rule at the range\'s end', () => {
        const editor = load('---\n\nab');

        selectAllOf(editor);
        paste(editor, ['text/plain'], [], { 'text/plain': 'Q' });

        expect(editor.getValue()).toBe('Q');
    });
});

// ---------------------------------------------------------------- a paste over a selected rule

describe('a paste with a rule selected replaces the rule where it stands, in the rule\'s own parent', () => {
    /**
     * The copied nodes of a range of a document.
     *
     * @param source - The document.
     * @param from - The range's start, or `null` for a selected first rule.
     * @param to - The range's end.
     * @returns The copied nodes.
     */
    function copied(source: string, from: TextPoint | null, to: TextPoint | null): CopiedNodes {
        const origin = load(source);

        if (from === null || to === null) {
            selectRule(origin);
        } else {
            selectText(origin, from, to);
        }

        return copySelection(origin);
    }

    const CLIPBOARDS: ReadonlyArray<readonly [string, () => CopiedNodes | string]> = [
        ['a copied rule', () => copied('a\n\n***\n\nb', null, null)],
        ['two paragraphs', () => copied('p1\n\np2', ['p1', 0], ['p2', 2])],
        ['a list', () => copied('- x\n- y', ['x', 0], ['y', 1])],
        ['a word', () => copied('hello', ['hello', 0], ['hello', 5])],
        ['plain text of two lines', () => 'plain words\nsecond'],
    ];

    const DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
        ['at the top level', 'a\n\n---\n\nb'],
        ['in a list item', '- a\n\n  ---\n- b'],
        ['in a quote', '> a\n>\n> ---\n>\n> b'],
        ['in a column', '::: columns\n---\n|||\nz\n:::'],
    ];

    const SAVES: Readonly<Record<string, readonly string[]>> = {
        'at the top level': ['a\n\n***\n\nb', 'a\n\np1\n\np2\n\nb', 'a\n\n- x\n- y\n\nb', 'a\n\nhello\n\nb', 'a\n\nplain words\n\nsecond\n\nb'],
        'in a list item':   ['- a\n\n  ***\n\n- b', '- a\n\n  p1\n\n  p2\n\n- b', '- a\n  - x\n  - y\n\n- b', '- a\n\n  hello\n\n- b', '- a\n\n  plain words\n\n  second\n\n- b'],
        'in a quote':       ['> a\n>\n> ***\n>\n> b', '> a\n>\n> p1\n>\n> p2\n>\n> b', '> a\n>\n> - x\n> - y\n>\n> b', '> a\n>\n> hello\n>\n> b', '> a\n>\n> plain words\n>\n> second\n>\n> b'],
        'in a column':      ['::: columns\n***\n|||\nz\n:::', '::: columns\np1\n\np2\n|||\nz\n:::', '::: columns\n- x\n- y\n|||\nz\n:::', '::: columns\nhello\n|||\nz\n:::', '::: columns\nplain words\n\nsecond\n|||\nz\n:::'],
    };

    it.each(DOCUMENTS.flatMap(([place, source]) => CLIPBOARDS.map(([clip, make], index) => [place, source, clip, make, SAVES[place]![index]!] as const)))(
        '%s, pasting %s', (_place, source, _clip, make, saved) => {
            const editor = load(source);
            const clipboard = make();

            selectRule(editor);

            if (typeof clipboard === 'string') {
                const transfer = { types: ['text/plain'], files: [], getData: (type: string) => (type === 'text/plain' ? clipboard : '') } as unknown as DataTransfer;
                const event = Object.assign(new ClipboardEvent('paste'), { clipboardData: transfer, preventDefault: () => {} });

                lexicalOf(editor).update(() => { lexicalOf(editor).dispatchCommand(PASTE_COMMAND, event); }, { discrete: true });
                settle(editor);
            } else {
                pasteNodes(editor, clipboard);
            }

            expect(editor.getValue()).toBe(saved);
            expectSaveKeepsDocument(editor, 'the paste');
        },
    );
});
