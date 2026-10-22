// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// MarkdownEditor holds a task item's checkbox as a node of its own, first in
// the item's text (plans/markdown-task-lists.md): what a load builds, what a
// save writes, and what each edit does in a task item. After every step the
// save loads as the document the editor shows, and the viewer reads it the
// same way.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createNodeSelection, $createRangeSelection, $getRoot, $getSelection, $selectAll, $isElementNode, $isRangeSelection, $isTextNode, $setSelection,
    CONTROLLED_TEXT_INSERTION_COMMAND, DELETE_CHARACTER_COMMAND, INDENT_CONTENT_COMMAND, INSERT_LINE_BREAK_COMMAND,
    KEY_BACKSPACE_COMMAND, KEY_ENTER_COMMAND, OUTDENT_CONTENT_COMMAND, PASTE_COMMAND, UNDO_COMMAND,
} from 'lexical';
import type { ElementNode, LexicalEditor, LexicalNode, RangeSelection, TextNode } from 'lexical';
import { $generateJSONFromSelectedNodes } from '@lexical/clipboard';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import type { MarkdownBlockType } from '~/component/editor/MarkdownEditor';
import { $isMarkdownRawBlockNode } from '~/component/editor/markdownSourceNodes';
import { $isMarkdownTaskCheckboxNode } from '~/component/editor/markdownTaskCheckboxNode';
import { BLANK_REFERENCES, taskBlankTextState } from '~/component/editor/markdownNodeState';
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

        if ($isMarkdownTaskCheckboxNode(node)) {
            return node.isChecked() ? 'checkbox(checked)' : 'checkbox(unchecked)';
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

/**
 * Marks a row as one whose steps are each one undo step.
 *
 * @param row - The row.
 * @returns The row, undone to its source at the end.
 */
function withUndo(row: Row): Row {
    return { ...row, undoesToSource: true };
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
    /** `true` when undoing every step, one undo for each, gives the source back. */
    readonly undoesToSource?: boolean;
    /** `false` for a row that holds an empty task item, which the editor shows as a checkbox and a reload as text: only the load is checked. */
    readonly checksSave?: boolean;
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

        if (row.checksSave !== false) {
            expectSaveKeepsDocument(editor, `step ${index + 1} (${step.key})`, row.comparesWithViewer);
        }

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

    if (row.undoesToSource === true) {
        row.steps.forEach(() => { press(editor, { key: 'undo' }); });

        expect(editor.getValue(), 'the source after undoing every step').toBe(row.source);
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


/**
 * A step that puts the caret before the checkbox of the item whose text holds `text`: an element point at offset 0 of
 * the item's text.
 *
 * @param text - The exact text of a text node in the item's text.
 * @returns The step.
 */
function selectBeforeCheckbox(text: string): Step {
    return command((editor) => {
        lexicalOf(editor).update(() => {
            const block = $textNode(text).getParent()!;
            const selection = $createRangeSelection();

            selection.anchor.set(block.getKey(), 0, 'element');
            selection.focus.set(block.getKey(), 0, 'element');
            $setSelection(selection);
        }, { discrete: true });
    });
}

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


const ITEM = 'markdown-list-item';
const TEXT = 'markdown-list-item-text';

describe('a task item loads with a checkbox and saves as it was written', () => {
    it.each<Row>([
        { name: 'a dash marker', source: '- [ ] a', steps: [], shape: `list(${ITEM}(${TEXT}(checkbox(unchecked), "a")))`, saved: '- [ ] a', standard: '- [ ] a' },
        { name: 'a star marker, checked', source: '* [x] a', steps: [], shape: `list(${ITEM}(${TEXT}(checkbox(checked), "a")))`, saved: '* [x] a', standard: '* [x] a' },
        { name: 'a plus marker, upper-case X', source: '+ [X] a', steps: [], shape: `list(${ITEM}(${TEXT}(checkbox(checked), "a")))`, saved: '+ [X] a', standard: '+ [X] a' },
        { name: 'a number and a dot', source: '1. [ ] a', steps: [], shape: `list(${ITEM}(${TEXT}(checkbox(unchecked), "a")))`, saved: '1. [ ] a', standard: '1. [ ] a' },
        { name: 'a number and a parenthesis', source: '1) [x] a', steps: [], shape: `list(${ITEM}(${TEXT}(checkbox(checked), "a")))`, saved: '1) [x] a', standard: '1) [x] a' },
        {
            name:   'a mixed list',
            source: '- [ ] a\n- b',
            steps:  [],
            shape:  `list(${ITEM}(${TEXT}(checkbox(unchecked), "a")), ${ITEM}(${TEXT}("b")))`,
            saved:  '- [ ] a\n- b',
        },
        {
            name:   'a nested task item',
            source: '- [ ] a\n  - [x] b',
            steps:  [],
            shape:  `list(${ITEM}(${TEXT}(checkbox(unchecked), "a"), list(${ITEM}(${TEXT}(checkbox(checked), "b")))))`,
            saved:  '- [ ] a\n  - [x] b',
        },
        {
            name:   'a loose task list',
            source: '- [ ] a\n\n- [x] b',
            steps:  [],
            shape:  `list(${ITEM}(${TEXT}(checkbox(unchecked), "a")), ${ITEM}(${TEXT}(checkbox(checked), "b")))`,
            saved:  '- [ ] a\n\n- [x] b',
        },
        {
            name:   'a task item holding a paragraph',
            source: '- [x] a\n\n  b',
            steps:  [],
            shape:  `list(${ITEM}(${TEXT}(checkbox(checked), "a"), paragraph("b")))`,
            saved:  '- [x] a\n\n  b',
        },
        {
            name:   'a task item in a quote',
            source: '> - [ ] q',
            steps:  [],
            shape:  `markdown-quote(list(${ITEM}(${TEXT}(checkbox(unchecked), "q"))))`,
            saved:  '> - [ ] q',
        },
        { name: 'a marker followed by spaces', source: '- [x]   a', steps: [], saved: '- [x]   a', standard: '- [x] a' },
        { name: 'a marker followed by a tab', source: '- [ ]\ta', steps: [], saved: '- [ ]\ta', standard: '- [ ] a' },
        { name: 'an escaped marker is text', source: '- \\[ \\] a', steps: [], shape: `list(${ITEM}(${TEXT}("[ ] a")))`, saved: '- \\[ \\] a' },
        { name: 'a marker with nothing after it is text', source: '- [ ]', steps: [], shape: `list(${ITEM}(${TEXT}("[ ]")))`, saved: '- [ ]' },
        {
            name:   'text holding a marker after the checkbox',
            source: '- [ ] \\[x\\] a',
            steps:  [],
            shape:  `list(${ITEM}(${TEXT}(checkbox(unchecked), "[x] a")))`,
            saved:  '- [ ] \\[x\\] a',
        },
        {
            name:   'a task item whose marker is a defined label',
            source: '[x]: /u\n\n- [x] done',
            steps:  [typeText('!', ['done', 4])],
            saved:  '[x]: /u\n\n- [x] done!',
        },
        {
            name:   'a task item opening with a no-break space',
            source: '- [x] &nbsp;a',
            steps:  [],
            shape:  `list(${ITEM}(${TEXT}(checkbox(checked), " a")))`,
            saved:  '- [x] &nbsp;a',
        },
        {
            name:   'a task item opening with a no-break space, edited',
            source: '- [x] &nbsp;a',
            steps:  [typeText('!', [' a', 2])],
            saved:  '- [x] &nbsp;a!',
        },
        {
            name:   'the blanks ending an item\'s text: an unchecked marker alone',
            source: '- [ ] ',
            steps:  [],
            shape:  `list(${ITEM}(${TEXT}("[ ]")))`,
            saved:  '- [ ] ',
        },
        {
            name:   'the blanks ending an item\'s text: a checked marker alone',
            source: '- [x] ',
            steps:  [],
            shape:  `list(${ITEM}(${TEXT}("[x]")))`,
            saved:  '- [x] ',
        },
        {
            name:   'the blanks ending an item\'s text: a plain item',
            source: '- a \n- b',
            steps:  [],
            shape:  `list(${ITEM}(${TEXT}("a")), ${ITEM}(${TEXT}("b")))`,
            saved:  '- a \n- b',
        },
        { name: 'an edited item keeps an upper-case X', source: '- [X] a', steps: [typeText('!', ['a', 1])], saved: '- [X] a!' },
    ])('$name', runRow);
});

describe('a task item with a task marker of every form saves so that it reloads as shown', () => {
    const MARKERS = ['-', '*', '+', '1.', '1)'] as const;
    const BOXES = ['[ ]', '[x]', '[X]'] as const;
    const PLACEMENTS: ReadonlyArray<readonly [name: string, wrap: (item: string, marker: string) => string]> = [
        ['the only item', (item) => item],
        ['the first of three', (item, marker) => `${item}\n${marker} b\n${marker} c`],
        ['the last of three', (item, marker) => `${marker} b\n${marker} c\n${item}`],
        ['nested under a plain item', (item, marker) => `${marker} b\n${' '.repeat(marker.length + 1)}${item}`],
        ['nested under a task item', (item, marker) => `${marker} [ ] b\n${' '.repeat(marker.length + 1)}${item}`],
        ['before a paragraph of the item', (item, marker) => `${item}\n\n${' '.repeat(marker.length + 1)}p`],
        ['before a nested list', (item, marker) => `${item}\n${' '.repeat(marker.length + 1)}${marker} n`],
        ['before a quote of the item', (item, marker) => `${item}\n\n${' '.repeat(marker.length + 1)}> q`],
        ['in a quote', (item) => `> ${item}`],
        ['in a column', (item) => `::: columns\n${item}\n|||\nb\n:::`],
        ['in a loose list', (item, marker) => `${item}\n\n${marker} b`],
    ];

    it.each(MARKERS.flatMap((marker) => BOXES.flatMap((box) => PLACEMENTS.map(([name, wrap]) => [marker, box, name, wrap] as const))))(
        '%s %s, %s',
        (marker, box, _name, wrap) => {
            const editor = load(wrap(`${marker} ${box} a`, marker));

            expectSaveKeepsDocument(editor, 'the load');

            press(editor, typeText('!', ['a', 1]));
            expectSaveKeepsDocument(editor, 'an edit of the item');
        },
    );

    it.each(MARKERS.flatMap((marker) => PLACEMENTS.map(([name, wrap]) => [marker, name, wrap] as const)))(
        'keeps a checkbox made in the editor: %s, %s',
        (marker, _name, wrap) => {
            const editor = load(wrap(`${marker} a`, marker));

            press(editor, command((target) => { target.toggleTaskList(); }, ['a', 1]));
            expectSaveKeepsDocument(editor, 'the task toggle');
            expect(shapeOf(editor)).toContain('checkbox(unchecked)');

            press(editor, typeText('!', ['a', 1]));
            expectSaveKeepsDocument(editor, 'an edit of the item');
        },
    );
});

describe('an emptied task item', () => {
    it('keeps its checkbox while the caret is in it, and gives it text again', () => {
        const editor = load('- [ ] a\n- b');

        press(editor, { key: 'Backspace', at: ['a', 1] });

        expect(shapeOf(editor)).toBe(`list(${ITEM}(${TEXT}(checkbox(unchecked))), ${ITEM}(${TEXT}("b")))`);
        expect(editor.getValue()).toBe('- [ ]\n- b');

        press(editor, typeText('z'));

        expect(shapeOf(editor)).toBe(`list(${ITEM}(${TEXT}(checkbox(unchecked), "z")), ${ITEM}(${TEXT}("b")))`);
        expect(editor.getValue()).toBe('- [ ] z\n- b');
        expectSaveKeepsDocument(editor, 'typing into the emptied item');
    });

    it('saves a checked empty task item escaped, so it is no definition reference', () => {
        const editor = load('- [x] a\n\n[x]: /u');

        press(editor, { key: 'Backspace', at: ['a', 1] });

        expect(shapeOf(editor)).toContain('checkbox(checked)');
        expect(editor.getValue()).toBe('- \\[x\\]\n\n[x]: /u');
    });

    it('shows the text its save reads as once an edit leaves the caret outside it', () => {
        const editor = load('- [ ] a\n- b');

        selectText(editor, ['a', 1]);
        lexicalOf(editor).update(() => {
            const b = $textNode('b');

            $textNode('a').remove();
            b.select(1, 1);
        }, { discrete: true });

        expect(shapeOf(editor)).toBe(`list(${ITEM}(${TEXT}("[ ]")), ${ITEM}(${TEXT}("b")))`);
        expect(editor.getValue()).toBe('- \\[ \\]\n- b');
        expectSaveKeepsDocument(editor, 'the caret leaving the emptied item');
    });
});

/** The modifier keys of a Ctrl/Cmd+Enter step: the key the platform uses, or both held so either platform reads it. */
type EnterModifiers = 'both' | 'control' | 'meta';

/**
 * A step that presses Enter with the key the platform toggles task items with: Ctrl off macOS and Cmd on macOS. Both are held
 * unless `modifiers` says one alone, so a row not about the platform reads either.
 *
 * @param at - Where the caret is put first, if anywhere.
 * @param to - The other end of a range.
 * @param modifiers - Which of the two keys are held.
 * @returns The step.
 */
function ctrlEnter(at?: TextPoint, to?: TextPoint, modifiers: EnterModifiers = 'both'): Step {
    return {
        key: 'command',
        at,
        to,
        run: (editor) => {
            lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, {
                ctrlKey: modifiers !== 'meta', metaKey: modifiers !== 'control', shiftKey: false, altKey: false, preventDefault: () => {},
            } as unknown as KeyboardEvent);
        },
    };
}

/**
 * The element a caret stands at, as the text of its block and its offset in it, for a caret that is no text point.
 *
 * @param editor - The editor.
 * @returns The block's type and the point's offset; `null` for a selection that is no collapsed range.
 */
function elementCaretOf(editor: MarkdownEditor): { block: string; offset: number } | null {
    return lexicalOf(editor).read(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.type !== 'element') {
            return null;
        }

        return { block: selection.anchor.getNode().getType(), offset: selection.anchor.offset };
    });
}

describe('Ctrl+Enter toggles the task items the selection touches', () => {
    it.each<Row>([
        { name: 'a caret in the second item', source: '- [ ] one\n- [x] two', steps: [ctrlEnter(['two', 1])], saved: '- [ ] one\n- [ ] two' },
        { name: 'a caret in the first item', source: '- [ ] one\n- [x] two', steps: [ctrlEnter(['one', 1])], saved: '- [x] one\n- [x] two' },
        { name: 'a range over both items', source: '- [ ] one\n- [x] two', steps: [ctrlEnter(['one', 1], ['two', 1])], saved: '- [x] one\n- [x] two' },
        { name: 'a range over checked items unchecks them', source: '- [x] a\n- [x] b', steps: [ctrlEnter(['a', 0], ['b', 1])], saved: '- [ ] a\n- [ ] b' },
        { name: 'a nested task item', source: '- a\n  - [ ] b', steps: [ctrlEnter(['b', 1])], saved: '- a\n  - [x] b' },
    ].map(withUndo))('$name', runRow);

    // Off macOS the key is Ctrl; Cmd is the key on macOS (markdown-editor-task-items-apple-keys.test.ts). A key that is
    // not the platform's toggles nothing, and Enter does what it does without it.
    it('off macOS, Ctrl alone toggles', () => {
        const editor = load('- [ ] one');

        press(editor, ctrlEnter(['one', 1], undefined, 'control'));

        expect(editor.getValue()).toBe('- [x] one');
    });

    it('off macOS, Meta or Super alone toggles nothing', () => {
        const editor = load('- [ ] one');

        press(editor, ctrlEnter(['one', 1], undefined, 'meta'));

        expect(editor.getValue()).not.toContain('[x]');
    });

    it('is one undo step', () => {
        const editor = load('- [ ] one\n- [x] two');

        press(editor, ctrlEnter(['one', 1], ['two', 1]));
        press(editor, { key: 'undo' });

        expect(editor.getValue()).toBe('- [ ] one\n- [x] two');
    });

    it.each([
        ['a plain item', '- a', 'a'],
        ['a paragraph', 'a', 'a'],
    ])('does what Enter does in %s', (_name, source, text) => {
        const withCtrl = load(source);
        const withoutCtrl = load(source);

        press(withCtrl, ctrlEnter([text, 1]));
        press(withoutCtrl, { key: 'Enter', at: [text, 1] });

        expect(withCtrl.getValue()).toBe(withoutCtrl.getValue());
        expect(shapeOf(withCtrl)).toBe(shapeOf(withoutCtrl));
    });
});

describe('Enter in a task item', () => {
    it.each<Row>([
        {
            name:       'at the end opens an unchecked one',
            source:     '- [ ] one',
            steps:      [{ key: 'Enter', at: ['one', 3] }],
            shape:      `list(${ITEM}(${TEXT}(checkbox(unchecked), "one")), ${ITEM}(${TEXT}(checkbox(unchecked))))`,
            saved:      '- [ ] one\n- [ ]',
            checksSave: false,
        },
        {
            name:   'in its text splits it',
            source: '- [x] two',
            steps:  [{ key: 'Enter', at: ['two', 1] }],
            shape:  `list(${ITEM}(${TEXT}(checkbox(checked), "t")), ${ITEM}(${TEXT}(checkbox(unchecked), "wo")))`,
            saved:  '- [x] t\n- [ ] wo',
        },
        {
            name:       'right after the checkbox opens a task item above',
            source:     '- [x] two',
            steps:      [{ key: 'Enter', at: ['two', 0] }],
            shape:      `list(${ITEM}(${TEXT}(checkbox(unchecked))), ${ITEM}(${TEXT}(checkbox(checked), "two")))`,
            saved:      '- [ ]\n- [x] two',
            caret:      ['two', 0],
            checksSave: false,
        },
        {
            name:       'on an empty task item ends the list',
            source:     '- [ ] one',
            steps:      [{ key: 'Enter', at: ['one', 3] }, { key: 'Enter' }],
            shape:      `list(${ITEM}(${TEXT}(checkbox(unchecked), "one"))) | paragraph()`,
            saved:      '- [ ] one',
            checksSave: false,
        },
        {
            name:       'on an empty nested task item moves it out one level',
            source:     '- a\n  - [ ] one',
            steps:      [{ key: 'Enter', at: ['one', 3] }, { key: 'Enter' }],
            savedAfter: ['- a\n  - [ ] one\n  - [ ]', '- a\n  - [ ] one\n- [ ]'],
            checksSave: false,
        },
        {
            name:       'on an empty nested task item, a third Enter ends the list',
            source:     '- a\n  - [ ] one',
            steps:      [{ key: 'Enter', at: ['one', 3] }, { key: 'Enter' }, { key: 'Enter' }],
            shape:      `list(${ITEM}(${TEXT}("a"), list(${ITEM}(${TEXT}(checkbox(unchecked), "one"))))) | paragraph()`,
            saved:      '- a\n  - [ ] one',
            checksSave: false,
        },
    ])('$name', runRow);

    it('leaves the caret after the new checkbox when it opens one at the end', () => {
        const editor = load('- [ ] one');

        press(editor, { key: 'Enter', at: ['one', 3] });

        expect(elementCaretOf(editor)).toEqual({ block: TEXT, offset: 1 });
    });

    it.each([
        ['at the end', '- [ ] one', ['one', 3] as TextPoint],
        ['in the text', '- [x] two', ['two', 1] as TextPoint],
        ['right after the checkbox', '- [x] two', ['two', 0] as TextPoint],
    ])('is one undo step %s', (_name, source, at) => {
        const editor = load(source);

        press(editor, { key: 'Enter', at });
        press(editor, { key: 'undo' });

        expect(editor.getValue()).toBe(source);
    });
});

describe('Backspace and a caret before the checkbox', () => {
    it.each<Row>([
        {
            name:   'Backspace right after the checkbox removes it',
            source: '- [ ] one\n- [x] two',
            steps:  [{ key: 'Backspace key', at: ['two', 0] }],
            saved:  '- [ ] one\n- two',
        },
        {
            name:   'Backspace after a nested item\'s checkbox removes it',
            source: '- a\n  - [x] two',
            steps:  [{ key: 'Backspace key', at: ['two', 0] }],
            saved:  '- a\n  - two',
        },
        {
            name:   'a second Backspace does what it does in a plain item',
            source: '- [ ] one\n- [x] two',
            steps:  [{ key: 'Backspace key', at: ['two', 0] }, { key: 'Backspace key' }],
            saved:  '- [ ] one\n\ntwo',
        },
        {
            name:   'a caret before the checkbox types after it',
            source: '- [ ] one\n- [x] two',
            steps:  [selectBeforeCheckbox('two'), { key: 'type', text: 'Z' }],
            saved:  '- [ ] one\n- [x] Ztwo',
        },
        {
            name:   'Backspace before the checkbox removes it',
            source: '- [ ] one\n- [x] two',
            steps:  [selectBeforeCheckbox('two'), { key: 'Backspace key' }],
            saved:  '- [ ] one\n- two',
        },
        {
            name:       'Enter before the checkbox opens a task item above',
            source:     '- [ ] one\n- [x] two',
            steps:      [selectBeforeCheckbox('two'), { key: 'Enter' }],
            saved:      '- [ ] one\n- [ ]\n- [x] two',
            checksSave: false,
        },
    ])('$name', runRow);

    it('Backspace right after the checkbox is one undo step', () => {
        const editor = load('- [ ] one\n- [x] two');

        press(editor, { key: 'Backspace key', at: ['two', 0] });
        press(editor, { key: 'undo' });

        expect(editor.getValue()).toBe('- [ ] one\n- [x] two');
    });

    it('a paste before the checkbox goes after it', () => {
        vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
        vi.stubGlobal('DragEvent', class DragEvent {});
        vi.stubGlobal('InputEvent', class InputEvent {});
        vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});

        const editor = load('- [ ] one\n- [x] two');
        const data: Record<string, string> = { 'text/plain': 'Q' };
        const event = Object.assign(new ClipboardEvent('paste'), {
            clipboardData: { types: Object.keys(data), files: [], getData: (type: string) => data[type] ?? '' }, preventDefault: () => {},
        });

        press(editor, selectBeforeCheckbox('two'));
        lexicalOf(editor).dispatchCommand(PASTE_COMMAND, event);
        vi.unstubAllGlobals();

        expect(editor.getValue()).toBe('- [ ] one\n- [x] Qtwo');
    });

    it('a caret before the checkbox is settled after it by code that inserts at the caret', () => {
        const editor = load('- [x] two');

        press(editor, selectBeforeCheckbox('two'));
        press(editor, { key: 'type', text: 'Z' });

        expect(shapeOf(editor)).toBe(`list(${ITEM}(${TEXT}(checkbox(checked), "Ztwo")))`);
    });
});

describe('a checkbox that code takes away from the start of its item\'s text', () => {
    it.each<Row>([
        {
            name:   'text inserted before a checkbox by code turns it into text',
            source: '- [x] done\n\n[x]: https://e.com',
            steps:  [
                selectBeforeCheckbox('done'),
                command((editor) => { lexicalOf(editor).update(() => { ($getSelection() as RangeSelection).insertText('}}'); }, { discrete: true }); }),
            ],
            saved:  '- }}\\[x\\] done\n\n[x]: https://e.com',
        },
        {
            name:   'a line break inserted before a checkbox by code turns it into text',
            source: '- [x] done\n\n[x]: /u',
            steps:  [
                selectBeforeCheckbox('done'),
                command((editor) => {
                    lexicalOf(editor).update(() => {
                        ($getSelection() as RangeSelection).insertText('a');
                        ($getSelection() as RangeSelection).insertLineBreak();
                    }, { discrete: true });
                }),
            ],
            saved:  '- a\\\n  \\[x\\] done\n\n[x]: /u',
        },
        {
            name:   'a checkbox joined into a paragraph becomes its text',
            source: 'p\n\n- [x] a',
            steps:  [{ key: 'Delete', at: ['p', 1] }],
            saved:  'p\\[x\\] a',
        },
        {
            name:   'bold over a task item formats its text',
            source: '- [ ] a',
            steps:  [
                command((editor) => {
                    lexicalOf(editor).update(() => {
                        const block = $textNode('a').getParent()!;
                        const selection = $createRangeSelection();

                        selection.anchor.set(block.getKey(), 0, 'element');
                        selection.focus.set($textNode('a').getKey(), 1, 'text');
                        $setSelection(selection);
                    }, { discrete: true });
                }),
                command((editor) => { editor.toggleBold(); }),
            ],
            saved:  '- [ ] **a**',
        },
    ])('$name', runRow);

    it('colour over a task item\'s checkbox styles nothing', () => {
        const editor = load('- [ ] a');

        press(editor, command((target) => {
            lexicalOf(target).update(() => {
                const block = $textNode('a').getParent()!;
                const selection = $createRangeSelection();

                selection.anchor.set(block.getKey(), 0, 'element');
                selection.focus.set($textNode('a').getKey(), 0, 'text');
                $setSelection(selection);
            }, { discrete: true });
        }));
        press(editor, command((target) => { target.setTextColor('#cc0000'); }));

        expect(editor.getValue()).toBe('- [ ] a');
    });
});

/**
 * A step that runs `toggleTaskList`.
 *
 * @param at - Where the caret is put first.
 * @param to - The other end of a range.
 * @returns The step.
 */
function toggleTasks(at?: TextPoint, to?: TextPoint): Step {
    return command((editor) => { editor.toggleTaskList(); }, at, to);
}

describe('toggleTaskList makes task items, or takes their checkboxes off', () => {
    it.each<Row>([
        { name: 'a caret in a plain item', source: '- a\n- b', steps: [toggleTasks(['a', 0])], saved: '- [ ] a\n- b' },
        { name: 'a range over two plain items', source: '- a\n- b', steps: [toggleTasks(['a', 0], ['b', 1])], saved: '- [ ] a\n- [ ] b' },
        { name: 'a range over a task item and a plain one', source: '- [ ] a\n- b', steps: [toggleTasks(['a', 0], ['b', 1])], saved: '- [ ] a\n- [ ] b' },
        { name: 'a range over task items takes their checkboxes off', source: '- [ ] a\n- [x] b', steps: [toggleTasks(['a', 0], ['b', 1])], saved: '- a\n- b' },
        { name: 'a range over two paragraphs', source: 'a\n\nb', steps: [toggleTasks(['a', 0], ['b', 1])], saved: '- [ ] a\n- [ ] b' },
        { name: 'a numbered item keeps its list kind', source: '1. a', steps: [toggleTasks(['a', 0])], saved: '1. [ ] a' },
        { name: 'a quote\'s paragraph', source: '> q', steps: [toggleTasks(['q', 0])], saved: '> - [ ] q' },
        { name: 'a further paragraph of an item becomes an item', source: '- a\n\n  p', steps: [toggleTasks(['p', 0])], saved: '- a\n\n- [ ] p' },
        { name: 'a heading in an item becomes the item\'s text', source: '- # h', steps: [toggleTasks(['h', 0])], saved: '- [ ] h' },
    ].map(withUndo))('$name', runRow);

    it.each([
        ['a caret in a plain item', '- a\n- b', ['a', 0] as TextPoint, undefined],
        ['a range over task items', '- [ ] a\n- [x] b', ['a', 0] as TextPoint, ['b', 1] as TextPoint],
    ])('is one undo step: %s', (_name, source, at, to) => {
        const editor = load(source);

        press(editor, toggleTasks(at, to));
        press(editor, { key: 'undo' });

        expect(editor.getValue()).toBe(source);
    });

    it('declines in a table cell', () => {
        const source = '| a |\n| - |\n| b |';
        const editor = load(source);

        press(editor, toggleTasks(['b', 0]));

        expect(editor.getValue()).toBe(source);
    });

    it('declines without a range selection', () => {
        const editor = load('- a');

        lexicalOf(editor).update(() => { $setSelection(null); }, { discrete: true });
        editor.toggleTaskList();

        expect(editor.getValue()).toBe('- a');
    });

    it('turns a heading that opens an item into the item\'s text and gives it a checkbox, in one document', () => {
        const editor = load('- # h\n- b');

        press(editor, toggleTasks(['h', 0], ['b', 1]));

        expect(editor.getValue()).toBe('- [ ] h\n- [ ] b');
    });
});

describe('the list toggles over a task item', () => {
    it.each<Row>([
        {
            name:   'toggleUnorderedList makes the item a paragraph and the marker its text',
            source: '- [ ] one\n- [x] two',
            steps:  [command((editor) => { editor.toggleUnorderedList(); }, ['one', 1])],
            saved:  '\\[ \\] one\n\n- [x] two',
        },
        {
            name:   'toggleOrderedList keeps the checkbox in a numbered item',
            source: '- [ ] one\n- [x] two',
            steps:  [command((editor) => { editor.toggleOrderedList(); }, ['one', 1])],
            saved:  '1. [ ] one\n\n- [x] two',
        },
        {
            name:   'a heading makes the marker its text',
            source: '- [x] one',
            steps:  [blockType('h2', ['one', 1])],
            saved:  '## \\[x\\] one',
        },
        {
            name:   'a code block holds the marker as text',
            source: '- [x] one',
            steps:  [blockType('code', ['one', 1])],
            saved:  '```\n[x] one\n```',
        },
        {
            name:   'a delete at the end of a paragraph before a task item joins its marker as text',
            source: 'p\n\n- [x] a',
            steps:  [{ key: 'Delete', at: ['p', 1] }],
            saved:  'p\\[x\\] a',
        },
    ])('$name', runRow);

    // The code holds the marker as the item showed it, not the escaped text the item's own save writes for a checkbox alone.
    it.each([
        ['a checked item', '- [x] a', '```\n[x]\n```'],
        ['an unchecked item', '- [ ] a', '```\n[ ]\n```'],
        ['an item loaded with a capital marker', '- [X] a', '```\n[X]\n```'],
        ['a checked item before another item', '- [x] a\n- b', '```\n[x]\n```\n\n- b'],
    ])('a code block made from %s emptied holds the marker as the item showed it', (_name, source, saved) => {
        const editor = load(source);

        press(editor, { key: 'Backspace', at: ['a', 1] });
        press(editor, blockType('code'));

        expect(editor.getValue()).toBe(saved);
        expectSaveKeepsDocument(editor, 'the code block');
    });

    it('a code block made from a lone checkbox written with a character reference holds the marker as the item showed it', () => {
        const editor = load('- [x] &#32;');

        press(editor, caretAtStart());
        press(editor, blockType('code'));

        expect(editor.getValue()).toBe('```\n[x]\n```');
        expectSaveKeepsDocument(editor, 'the code block');
    });
});

describe('a task item copied and pasted', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps its checkbox when the copy starts before it', () => {
        const origin = load('- [x] done');

        lexicalOf(origin).update(() => {
            const block = $textNode('done').getParent()!;
            const selection = $createRangeSelection();

            selection.anchor.set(block.getKey(), 0, 'element');
            selection.focus.set($textNode('done').getKey(), 4, 'text');
            $setSelection(selection);
        }, { discrete: true });

        const lexical = lexicalOf(origin);
        const nodes = lexical.read(() => $generateJSONFromSelectedNodes(lexical, $getSelection()).nodes);
        const editor = load('para');

        selectText(editor, ['para', 2]);
        pasteNodes(editor, nodes);

        expect(editor.getValue()).toBe('pa\n\n- [x] done\n\nra');
    });

    it('makes the item a task item when pasted at the start of an item\'s text', () => {
        const origin = load('- [x] done');

        lexicalOf(origin).update(() => {
            const block = $textNode('done').getParent()!;
            const selection = $createRangeSelection();

            selection.anchor.set(block.getKey(), 0, 'element');
            selection.focus.set($textNode('done').getKey(), 4, 'text');
            $setSelection(selection);
        }, { discrete: true });

        const lexical = lexicalOf(origin);
        const nodes = lexical.read(() => $generateJSONFromSelectedNodes(lexical, $getSelection()).nodes);
        const editor = load('- b');

        selectText(editor, ['b', 0]);
        pasteNodes(editor, nodes);

        expect(editor.getValue()).toBe('- [x] doneb');
    });

    it('becomes its text when pasted in the middle of a paragraph', () => {
        // The inline nodes a copy inside one task item's text holds: the checkbox and a text.
        const origin = load('- [ ] x');
        const lexical = lexicalOf(origin);
        const nodes = lexical.read(() => $textNode('x').getParent()!.getChildren().map((node) => node.exportJSON())) as ReturnType<typeof copied>;
        const editor = load('ab');

        selectText(editor, ['ab', 1]);
        pasteNodes(editor, nodes);

        expect(editor.getValue()).toBe('a\\[ \\] xb');
    });

    it('keeps the character reference of a lone checkbox, so it is still a checkbox', () => {
        const editor = load('para');

        selectText(editor, ['para', 2]);
        pasteNodes(editor, copiedDocument('- [x] &#32;'));

        expect(editor.getValue()).toBe('pa\n\n- [x] &#32;\n\nra');
        expectSaveKeepsDocument(editor, 'the paste');
    });
});

/**
 * A step that selects from before the checkbox of the item whose text holds `text` to a text point.
 *
 * @param text - The exact text of a text node in the item's text.
 * @param to - The end of the range.
 * @returns The step.
 */
function rangeFromBeforeCheckbox(text: string, to: TextPoint): Step {
    return command((editor) => {
        lexicalOf(editor).update(() => {
            const block = $textNode(text).getParent()!;
            const selection = $createRangeSelection();

            selection.anchor.set(block.getKey(), 0, 'element');
            selection.focus.set($textNode(to[0]).getKey(), to[1], 'text');
            $setSelection(selection);
        }, { discrete: true });
    });
}

describe('a link never wraps a task item\'s checkbox', () => {
    const URL = 'https://u.test';

    it.each<Row>([
        {
            name:   'a range from before the checkbox links the text',
            source: '- [ ] a',
            steps:  [rangeFromBeforeCheckbox('a', ['a', 1]), command((editor) => { editor.toggleLink(URL); })],
            saved:  `- [ ] [a](${URL})`,
        },
        {
            name:   'Select All links the text of each item',
            source: '- [ ] a\n- [x] b',
            steps:  [
                command((editor) => { lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true }); }),
                command((editor) => { editor.toggleLink(URL); }),
            ],
            saved:  `- [ ] [a](${URL})\n- [x] [b](${URL})`,
        },
        {
            name:   'a range across items links the text of each item',
            source: '- [ ] a\n- [x] b',
            steps:  [command((editor) => { editor.toggleLink(URL); }, ['a', 0], ['b', 1])],
            saved:  `- [ ] [a](${URL})\n- [x] [b](${URL})`,
        },
    ])('$name', runRow);

    it('is one undo step', () => {
        const editor = load('- [ ] a\n- [x] b');

        press(editor, command((target) => { target.toggleLink(URL); }, ['a', 0], ['b', 1]));
        press(editor, { key: 'undo' });

        expect(editor.getValue()).toBe('- [ ] a\n- [x] b');
    });
});

describe('Enter at the start of a link, bold or italic text keeps the checkbox with the text before the caret', () => {
    const URL = 'https://u.test';

    it.each<Row>([
        {
            name:   'a link after text',
            source: `- [x] ab [link](${URL})`,
            steps:  [{ key: 'Enter', at: ['link', 0] }],
            saved:  `- [x] ab\n- [ ] [link](${URL})`,
        },
        {
            name:       'a link right after the checkbox',
            source:     `- [x] [link](${URL}) z`,
            steps:      [{ key: 'Enter', at: ['link', 0] }],
            saved:      `- [ ]\n- [x] [link](${URL}) z`,
            checksSave: false,
        },
        {
            name:   'bold text after text',
            source: '- [x] ab **bold**',
            steps:  [{ key: 'Enter', at: ['bold', 0] }],
            saved:  '- [x] ab\n- [ ] **bold**',
        },
        {
            name:       'bold text right after the checkbox',
            source:     '- [x] **bold** z',
            steps:      [{ key: 'Enter', at: ['bold', 0] }],
            saved:      '- [ ]\n- [x] **bold** z',
            checksSave: false,
        },
        {
            name:   'italic text after text',
            source: '- [x] ab *it*',
            steps:  [{ key: 'Enter', at: ['it', 0] }],
            saved:  '- [x] ab\n- [ ] *it*',
        },
    ])('$name', runRow);
});

describe('a block insert with the caret before a task item\'s checkbox goes above the item', () => {
    // The plain item is the model: the block goes where it goes with the caret at the start of a plain item's text,
    // and the task item keeps its checkbox in the same place.
    const WITHOUT_CHECKBOXES = (saved: string): string => saved.replace(/\[[ xX]\] /g, '');

    const DOCUMENTS: ReadonlyArray<readonly [name: string, task: string, plain: string, text: string]> = [
        ['a first item', '- [ ] one\n- [x] two', '- one\n- two', 'one'],
        ['a later item', '- [ ] one\n- [x] two', '- one\n- two', 'two'],
        ['a nested item', '- [ ] one\n  - [x] two', '- one\n  - two', 'two'],
    ];

    it.each(DOCUMENTS.flatMap(([name, task, plain, text]) => [
        [`insertHorizontalRule, ${name}`, task, plain, text, (editor: MarkdownEditor) => { editor.insertHorizontalRule(); }] as const,
        [`insertTable, ${name}`, task, plain, text, (editor: MarkdownEditor) => { editor.insertTable(2, 2); }] as const,
    ]))('%s', (_name, task, plain, text, insert) => {
        const model = load(plain);

        press(model, caretAtStartOf(text));
        press(model, command(insert));

        const editor = load(task);

        press(editor, selectBeforeCheckbox(text));
        press(editor, command(insert));

        expect(WITHOUT_CHECKBOXES(editor.getValue())).toBe(model.getValue());
        expect(editor.getValue().match(/\[[ x]\] /g)).toHaveLength(2);
    });
});

/**
 * Copies one block of a document as Lexical's clipboard copies a selected block.
 *
 * @param source - The document.
 * @param type - The Lexical type of the block: the first one of that type in the document.
 * @returns The copied nodes.
 */
function copiedBlock(source: string, type: string): ReturnType<typeof copied> {
    const editor = load(source);
    const lexical = lexicalOf(editor);

    lexical.update(() => {
        const block = $dfs($getRoot()).map(({ node }) => node).find((node) => node.getType() === type)!;
        const selection = $createNodeSelection();

        selection.add(block.getKey());
        $setSelection(selection);
    }, { discrete: true });

    return lexical.read(() => $generateJSONFromSelectedNodes(lexical, $getSelection()).nodes);
}

/**
 * Copies a whole document as Lexical's clipboard copies it.
 *
 * @param source - The document.
 * @returns The copied nodes.
 */
function copiedDocument(source: string): ReturnType<typeof copied> {
    const editor = load(source);
    const lexical = lexicalOf(editor);

    lexical.update(() => { $selectAll(); }, { discrete: true });

    return lexical.read(() => $generateJSONFromSelectedNodes(lexical, $getSelection()).nodes);
}

/** The ways a block goes in at the caret: the two insert commands, and a pasted rule or table. */
const BLOCK_INSERTS: ReadonlyArray<readonly [name: string, insert: (editor: MarkdownEditor) => void]> = [
    ['insertHorizontalRule', (editor) => { editor.insertHorizontalRule(); }],
    ['insertTable', (editor) => { editor.insertTable(2, 2); }],
    ['a pasted rule', (editor) => { pasteNodes(editor, copiedBlock('a\n\n---\n\nb', 'markdown-horizontal-rule')); }],
    ['a pasted table', (editor) => { pasteNodes(editor, copiedBlock('| h |\n| --- |\n| c |', 'table')); }],
];

describe('a block insert or paste with the caret right after a task item\'s checkbox goes above the item', () => {
    // The caret a click on the item's text gives. The plain item is the model, as for the caret before the checkbox:
    // the block goes where it goes at the start of a plain item's text, and the task item keeps its checkbox.
    const WITHOUT_CHECKBOXES = (saved: string): string => saved.replace(/\[[ xX]\] /g, '');
    const CHECKBOXES = (saved: string): number => saved.match(/\[[ x]\] /g)?.length ?? 0;

    const DOCUMENTS: ReadonlyArray<readonly [name: string, task: string, plain: string, text: string]> = [
        ['a first item', '- [ ] one\n- [x] two', '- one\n- two', 'one'],
        ['a later item', '- [ ] one\n- [x] two', '- one\n- two', 'two'],
        ['an item holding a nested task item', '- [ ] one\n  - [x] two', '- one\n  - two', 'one'],
        ['a nested item', '- [ ] one\n  - [x] two', '- one\n  - two', 'two'],
        ['a nested item under a plain item', '- a\n  - [x] bc', '- a\n  - bc', 'bc'],
    ];

    it.each(DOCUMENTS.flatMap(([name, task, plain, text]) => BLOCK_INSERTS.map(([how, insert]) => [`${how}, ${name}`, task, plain, text, insert] as const)))(
        '%s', (_name, task, plain, text, insert) => {
            const model = load(plain);

            press(model, caretAtStartOf(text));
            press(model, command(insert));

            const editor = load(task);

            press(editor, caretAtStartOf(text));
            press(editor, command(insert));

            expect(WITHOUT_CHECKBOXES(editor.getValue())).toBe(model.getValue());
            expect(CHECKBOXES(editor.getValue())).toBe(CHECKBOXES(task));
            expect(holdsMarkerText(editor)).toBe(false);
            expectSaveKeepsDocument(editor, 'the insert');
        },
    );

    it.each([
        ['a rule inserted', (editor: MarkdownEditor) => { editor.insertHorizontalRule(); }],
        ['a rule pasted', (editor: MarkdownEditor) => { pasteNodes(editor, copiedBlock('a\n\n---\n\nb', 'markdown-horizontal-rule')); }],
    ])('%s there leaves the caret after the checkbox, where typing goes', (_name, insert) => {
        const editor = load('- [x] one');

        press(editor, caretAtStartOf('one'));
        press(editor, command(insert));
        press(editor, typeText('Q'));

        expect(editor.getValue()).toBe('---\n\n- [x] Qone');
    });
});

describe('a block insert or paste inside a task item\'s text makes the text after the caret an unchecked task item, as Enter does', () => {
    const PASTED_RULE = (editor: MarkdownEditor): void => { pasteNodes(editor, copiedBlock('a\n\n---\n\nb', 'markdown-horizontal-rule')); };
    const PASTED_TABLE = (editor: MarkdownEditor): void => { pasteNodes(editor, copiedBlock('| h |\n| --- |\n| c |', 'table')); };
    const PASTED_PARAGRAPH_AND_RULE = (editor: MarkdownEditor): void => { pasteNodes(editor, copiedDocument('P\n\n---')); };
    const RULE = (editor: MarkdownEditor): void => { editor.insertHorizontalRule(); };
    const TABLE = (editor: MarkdownEditor): void => { editor.insertTable(2, 2); };
    const EMPTY_TABLE = '|  |  |\n| --- | --- |\n|  |  |';

    it.each<[string, string, (editor: MarkdownEditor) => void, string]>([
        ['a rule inserted in a checked item', '- [x] bc', RULE, '- [x] b\n\n---\n\n- [ ] c'],
        ['a table inserted in an unchecked item', '- [ ] bc', TABLE, `- [ ] b\n\n${EMPTY_TABLE}\n\n- [ ] c`],
        ['a rule inserted in a nested item', '- a\n  - [ ] bc', RULE, '- a\n\n  - [ ] b\n\n  ---\n\n  - [ ] c'],
        ['a rule pasted in an unchecked item', '- [ ] bc', PASTED_RULE, '- [ ] b\n\n  ---\n\n- [ ] c'],
        ['a rule pasted in a checked item', '- [x] bc', PASTED_RULE, '- [x] b\n\n  ---\n\n- [ ] c'],
        ['a table pasted in a checked item', '- [x] bc', PASTED_TABLE, '- [x] b\n\n| h |\n| --- |\n| c |\n\n- [ ] c'],
        ['a paragraph and a rule pasted in an unchecked item', '- [ ] bc', PASTED_PARAGRAPH_AND_RULE, '- [ ] bP\n\n  ---\n\n- [ ] c'],
        ['a rule pasted in a nested item', '- a\n  - [ ] bc', PASTED_RULE, '- a\n  - [ ] b\n\n    ---\n\n  - [ ] c'],
        ['a table pasted in a nested item', '- a\n  - [ ] bc', PASTED_TABLE, '- a\n\n  - [ ] b\n\n  | h |\n  | --- |\n  | c |\n\n  - [ ] c'],
    ])('%s', (_name, source, insert, saved) => {
        const editor = load(source);

        press(editor, command(insert, ['bc', 1]));

        expect(editor.getValue()).toBe(saved);
        expect(holdsMarkerText(editor)).toBe(false);
        expectSaveKeepsDocument(editor, 'the insert');
    });

    it('leaves Enter there making one unchecked task item, as before', () => {
        const editor = load('- [x] bc');

        press(editor, { key: 'Enter', at: ['bc', 1] });

        expect(editor.getValue()).toBe('- [x] b\n- [ ] c');
    });
});

/**
 * A step that puts the caret at the start of the text node whose text is exactly `text`.
 *
 * @param text - The text.
 * @returns The step.
 */
function caretAtStartOf(text: string): Step {
    return command(() => {}, [text, 0]);
}

/**
 * The document's shape with its checkboxes left out, so a task item can be compared with the plain item it stands for.
 *
 * @param editor - The editor.
 * @returns The shape without any checkbox.
 */
function shapeWithoutCheckboxes(editor: MarkdownEditor): string {
    return shapeOf(editor).replace(/checkbox\((?:un)?checked\)(?:, )?/g, '');
}

/**
 * Whether any text node of the document reads like a task marker (`[ ]` or `[x]` as text).
 *
 * @param editor - The editor.
 * @returns `true` when one does.
 */
function holdsMarkerText(editor: MarkdownEditor): boolean {
    return /"\[[ xX]\]/.test(shapeOf(editor));
}

describe('Enter on an emptied task item does what Enter does on the same plain item', () => {
    const URL_FREE: ReadonlyArray<readonly [name: string, task: string, plain: string, text: string]> = [
        ['an item holding a quote', '- [ ] a\n\n  > q', '- a\n\n  > q', 'a'],
        ['an item holding a nested list', '- [ ] a\n  - n', '- a\n  - n', 'a'],
        ['an item with nothing else', '- [ ] a\n- b', '- a\n- b', 'a'],
    ];

    it.each(URL_FREE)('%s', (_name, task, plain, text) => {
        const model = load(plain);

        press(model, { key: 'Backspace', at: [text, 1] });
        press(model, { key: 'Enter' });

        const editor = load(task);

        press(editor, { key: 'Backspace', at: [text, 1] });
        press(editor, { key: 'Enter' });

        expect(shapeWithoutCheckboxes(editor)).toBe(shapeOf(model));
        expect(holdsMarkerText(editor)).toBe(false);
    });

    // A plain item emptied while it holds a further paragraph takes that paragraph for its text, so it has no twin
    // here; what the blank-text rule does on an empty item with a further paragraph is to leave the item and put the
    // caret in the paragraph, and the checkbox it holds alone stays with the item.
    // The item's text is not touched by the key, so the rule that turns a checkbox standing alone into text does not
    // run on it: the editor shows the checkbox, the save is `- [ ]` and a reload of that shows the text `[ ]`.
    it.each([
        [
            'an item holding a further paragraph', '- [ ] a\n\n  p', '- [ ]\n\n  p',
            'list(markdown-list-item(markdown-list-item-text(checkbox(unchecked)), paragraph("p")))',
            'list(markdown-list-item(markdown-list-item-text("[ ]"), paragraph("p")))',
        ],
        [
            'a nested item holding a further paragraph', '- x\n  - [ ] a\n\n    p', '- x\n  - [ ]\n\n    p',
            'list(markdown-list-item(markdown-list-item-text("x"), list(markdown-list-item(markdown-list-item-text(checkbox(unchecked)), paragraph("p")))))',
            'list(markdown-list-item(markdown-list-item-text("x"), list(markdown-list-item(markdown-list-item-text("[ ]"), paragraph("p")))))',
        ],
    ])('keeps the checkbox on an item that stays with its further paragraph: %s', (_name, source, saved, shape, reloadedShape) => {
        const editor = load(source);

        press(editor, { key: 'Backspace', at: ['a', 1] });
        press(editor, { key: 'Enter' });

        expect(shapeOf(editor)).toBe(shape);
        expect(editor.getValue()).toBe(saved);
        expect(shapeOf(load(saved))).toBe(reloadedShape);
        expect(holdsMarkerText(editor)).toBe(false);
    });
});

describe('Enter over a range inside a task item\'s text', () => {
    it('that empties the text of an item holding a nested list does what it does on a plain item', () => {
        const model = load('- abc\n  - n');

        press(model, { key: 'Enter', at: ['abc', 0], to: ['abc', 3] });

        const editor = load('- [ ] abc\n  - n');

        press(editor, { key: 'Enter', at: ['abc', 0], to: ['abc', 3] });

        expect(shapeWithoutCheckboxes(editor)).toBe(shapeOf(model));
        expect(holdsMarkerText(editor)).toBe(false);
    });

    it('that empties the text of an item with nothing else splits it as it does a plain item', () => {
        const model = load('- abc');

        press(model, { key: 'Enter', at: ['abc', 0], to: ['abc', 3] });

        const editor = load('- [x] abc');

        press(editor, { key: 'Enter', at: ['abc', 0], to: ['abc', 3] });

        expect(shapeWithoutCheckboxes(editor)).toBe(shapeOf(model));
        expect(holdsMarkerText(editor)).toBe(false);
    });

    it('that leaves text on both sides opens an unchecked task item, as a caret does', () => {
        const editor = load('- [x] abc');

        press(editor, { key: 'Enter', at: ['abc', 1], to: ['abc', 2] });

        expect(editor.getValue()).toBe('- [x] a\n- [ ] c');
        expectSaveKeepsDocument(editor, 'Enter over a range');
    });

    it('is one undo step', () => {
        const editor = load('- [x] abc');

        press(editor, { key: 'Enter', at: ['abc', 1], to: ['abc', 2] });
        press(editor, { key: 'undo' });

        expect(editor.getValue()).toBe('- [x] abc');
    });
});

describe('toggleTaskList over an empty block makes a task item that keeps its checkbox', () => {
    // An item or paragraph with no text has no Markdown form as a task item: `- [ ]` reads as an item holding the
    // text `[ ]`. The editor shows the checkbox, as it does for the empty item Enter opens, and the save is `- [ ]`
    // (`- \\[x\\]` when checked); a reload of that shows the text `[ ]`, and so does the item's next edit away from it.
    const MIDDLE_EMPTY = `list(${ITEM}(${TEXT}(checkbox(unchecked), "a")), ${ITEM}(${TEXT}(checkbox(unchecked))), ${ITEM}(${TEXT}(checkbox(unchecked), "c")))`;
    const PLAIN_MIDDLE_EMPTY = `list(${ITEM}(${TEXT}("a")), ${ITEM}(${TEXT}()), ${ITEM}(${TEXT}("c")))`;

    /**
     * A step that makes an empty paragraph between `a` and `c` by pressing Enter at the end of `a`.
     *
     * @returns The step.
     */
    function emptyParagraphBetween(): Step {
        return { key: 'Enter', at: ['a', 1] };
    }

    it('a range over an item with no text makes it a task item with its checkbox', () => {
        const editor = load('- a\n-\n- c');

        expect(shapeOf(editor)).toBe(PLAIN_MIDDLE_EMPTY);

        press(editor, toggleTasks(['a', 0], ['c', 1]));

        expect(shapeOf(editor)).toBe(MIDDLE_EMPTY);
        expect(editor.getValue()).toBe('- [ ] a\n- [ ]\n- [ ] c');
        expect(shapeOf(load(editor.getValue()))).toBe(`list(${ITEM}(${TEXT}(checkbox(unchecked), "a")), ${ITEM}(${TEXT}("[ ]")), ${ITEM}(${TEXT}(checkbox(unchecked), "c")))`);
    });

    it('a second toggle over an item with no text takes the checkboxes off and leaves no text', () => {
        const editor = load('- a\n-\n- c');

        press(editor, toggleTasks(['a', 0], ['c', 1]));
        press(editor, toggleTasks(['a', 0], ['c', 1]));

        expect(shapeOf(editor)).toBe(PLAIN_MIDDLE_EMPTY);
        expect(editor.getValue()).toBe('- a\n-\n- c');
        expect(holdsMarkerText(editor)).toBe(false);
    });

    it('toggling on, off and on again over an item with no text gives the first result again', () => {
        const editor = load('- a\n-\n- c');

        press(editor, toggleTasks(['a', 0], ['c', 1]));
        press(editor, toggleTasks(['a', 0], ['c', 1]));
        press(editor, toggleTasks(['a', 0], ['c', 1]));

        expect(shapeOf(editor)).toBe(MIDDLE_EMPTY);
        expect(editor.getValue()).toBe('- [ ] a\n- [ ]\n- [ ] c');
    });

    it('each toggle over an item with no text is one undo step', () => {
        const editor = load('- a\n-\n- c');

        press(editor, toggleTasks(['a', 0], ['c', 1]));
        press(editor, toggleTasks(['a', 0], ['c', 1]));
        press(editor, { key: 'undo' });

        expect(shapeOf(editor)).toBe(MIDDLE_EMPTY);

        press(editor, { key: 'undo' });

        expect(shapeOf(editor)).toBe(PLAIN_MIDDLE_EMPTY);
    });

    it('an empty paragraph made by Enter between two paragraphs becomes a task item too', () => {
        const editor = load('a\n\nc');

        press(editor, emptyParagraphBetween());

        expect(shapeOf(editor)).toBe('paragraph("a") | paragraph() | paragraph("c")');

        press(editor, toggleTasks(['a', 0], ['c', 1]));

        expect(shapeOf(editor)).toBe(MIDDLE_EMPTY);
        expect(editor.getValue()).toBe('- [ ] a\n- [ ]\n- [ ] c');
        expect(holdsMarkerText(editor)).toBe(false);
    });

    it('an empty paragraph made a task item and toggled off again is an empty item with no text', () => {
        const editor = load('a\n\nc');

        press(editor, emptyParagraphBetween());
        press(editor, toggleTasks(['a', 0], ['c', 1]));
        press(editor, toggleTasks(['a', 0], ['c', 1]));

        expect(shapeOf(editor)).toBe(PLAIN_MIDDLE_EMPTY);
        expect(holdsMarkerText(editor)).toBe(false);
    });

    it('a lone empty item becomes a task item with the caret after its checkbox', () => {
        const editor = load('- a');

        press(editor, { key: 'Backspace', at: ['a', 1] });
        press(editor, toggleTasks());

        expect(shapeOf(editor)).toBe(`list(${ITEM}(${TEXT}(checkbox(unchecked))))`);
        expect(editor.getValue()).toBe('- [ ]');
        expect(elementCaretOf(editor)).toEqual({ block: TEXT, offset: 1 });

        press(editor, typeText('z'));

        expect(editor.getValue()).toBe('- [ ] z');
    });

    it('a lone empty item toggled off leaves an empty item with no text', () => {
        const editor = load('- a');

        press(editor, { key: 'Backspace', at: ['a', 1] });
        press(editor, toggleTasks());
        press(editor, toggleTasks());

        expect(shapeOf(editor)).toBe(`list(${ITEM}(${TEXT}()))`);
        expect(holdsMarkerText(editor)).toBe(false);
    });
});

describe('a lone checkbox loaded from a character reference for a space', () => {
    // A character reference for a space is no blank to `marked`, so the marker has text after it and is a checkbox, in
    // the viewer and the editor alike; the item then shows nothing after it. The checkbox keeps the reference, so its
    // save, toggled or not, still reads as a checkbox: Markdown has no other form of a task item with no text.
    it('is a checkbox in the viewer and the editor, and saves as it was written', () => {
        const editor = load('- [x] &#32;');

        expect(shapeOf(editor)).toBe(`list(${ITEM}(${TEXT}(checkbox(checked))))`);
        expect(editor.getValue()).toBe('- [x] &#32;');
        expect(canonicalSave(editor)).toBe('- [x] &#32;');
        expectSaveKeepsDocument(editor, 'the load');
    });

    it('stays a checkbox once a click unchecks it, saved with its character reference', () => {
        const editor = load('- [x] &#32;');

        lexicalOf(editor).update(() => {
            const box = $dfs($getRoot()).map(({ node }) => node).find($isMarkdownTaskCheckboxNode)!;

            box.setChecked(false);
        }, { discrete: true });

        expect(editor.getValue()).toBe('- [ ] &#32;');
        expect(shapeOf(editor)).toBe(`list(${ITEM}(${TEXT}(checkbox(unchecked))))`);
        expect(shapeOf(load(editor.getValue()))).toBe(`list(${ITEM}(${TEXT}(checkbox(unchecked))))`);
        expectSaveKeepsDocument(editor, 'the click');
    });

    it.each<Row>([
        {
            name:   'Ctrl+Enter toggles it and keeps the reference',
            source: '- [x] &#32;\n- b',
            steps:  [caretAtStart(), ctrlEnter()],
            saved:  '- [ ] &#32;\n- b',
            shape:  `list(${ITEM}(${TEXT}(checkbox(unchecked))), ${ITEM}(${TEXT}("b")))`,
        },
        {
            name:   'a numbered list keeps it a checkbox',
            source: '- [x] &#32;',
            steps:  [caretAtStart(), command((editor) => { editor.toggleOrderedList(); })],
            saved:  '1. [x] &#32;',
            shape:  `list(${ITEM}(${TEXT}(checkbox(checked))))`,
        },
        {
            name:   'text typed after it and deleted again leaves it a checkbox, with the caret elsewhere',
            source: '- [x] &#32;\n- b',
            steps:  [caretAtStart(), typeText('z'), { key: 'Backspace', at: ['z', 1] }, command(() => {}, ['b', 1])],
            saved:  '- [x] &#32;\n- b',
            shape:  `list(${ITEM}(${TEXT}(checkbox(checked))), ${ITEM}(${TEXT}("b")))`,
        },
    ])('$name', runRow);

    // A space that is not ASCII whitespace is content to `marked` and to the editor (`holdsLineContent`): typed after
    // a checkbox in place of its text, it stays in the save, and a character reference for it is shown, not kept. A
    // save of a task item reloads as a task item with the same state and text; `marked` reads a task marker only when a
    // `\S` character follows it, and JavaScript's `\S` does not match these spaces, so the space is written as a
    // numeric character reference (as a no-break space is written `&nbsp;`).
    it.each([['\u00a0', '&nbsp;'], ['\u2003', '&#8195;'], ['\u3000', '&#12288;']])('a space typed in place of the text after a checkbox (U+%#x) is saved', (space, written) => {
        const editor = load('- [x] a\n- b');

        press(editor, typeText(space, ['a', 0], ['a', 1]));
        press(editor, command(() => {}, ['b', 1]));

        expect(editor.getValue()).toBe(`- [x] ${written}\n- b`);
        expectSaveKeepsDocument(editor, 'the typed space');
    });

    it.each(['\u2003', '\u3000'])('a code block made from that item holds the marker and the space (U+%#x)', (space) => {
        const editor = load('- [x] a');

        press(editor, typeText(space, ['a', 0], ['a', 1]));
        press(editor, { key: 'command', run: (target: MarkdownEditor) => { target.setBlockType('code'); } });

        expect(editor.getValue()).toBe(`\`\`\`\n[x] ${space}\n\`\`\``);
    });

    it.each(['&#160;', '&#8195;', '&#12288;'])('%s after a checkbox shows its space, which stays once an edit elsewhere saves', (reference) => {
        const editor = load(`- [x] ${reference}\n- b`);

        press(editor, typeText('Y', ['b', 1]));

        expect(editor.getValue()).toBe(`- [x] ${reference}\n- bY`);
        expect(shapeOf(load(editor.getValue()))).toBe(shapeOf(editor));
    });

    it.each(['&#160;', '&#8195;', '&#12288;'])('%s after a checkbox, the space deleted, leaves a checkbox with no reference', (reference) => {
        const editor = load(`- [x] ${reference}\n- b`);

        press(editor, { key: 'Backspace', at: [reference === '&#160;' ? '\u00a0' : reference === '&#8195;' ? '\u2003' : '\u3000', 1] });
        press(editor, typeText('Y', ['b', 1]));

        expect(editor.getValue()).toBe('- \\[x\\]\n- bY');
    });

    // Every space outside ASCII that JavaScript's `\s` matches, as `marked`'s task test (`\S` after the marker) sees it.
    const NON_ASCII_SPACES = [0x00a0, 0x1680, ...Array.from({ length: 11 }, (_unused, index) => 0x2000 + index), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]
        .filter((code) => /\s/.test(String.fromCodePoint(code)));

    it('the sweep holds every non-ASCII space JavaScript matches with \\s', () => {
        const matched = Array.from({ length: 0x10000 }, (_unused, code) => code).filter((code) => code > 0x7f && /\s/.test(String.fromCodePoint(code)));

        expect(NON_ASCII_SPACES).toEqual(matched);
    });

    it.each(NON_ASCII_SPACES.map((code) => ({ code, name: `U+${code.toString(16).toUpperCase().padStart(4, '0')}` })))('$name typed after a checkbox, or loaded as a reference and toggled, saves as a task item', ({ code }) => {
        const space = String.fromCodePoint(code);
        const typed = load('- [x] a\n- b');

        press(typed, typeText(space, ['a', 0], ['a', 1]));
        press(typed, command(() => {}, ['b', 1]));

        expectSaveKeepsDocument(typed, 'the typed space');
        expect(shapeOf(load(typed.getValue()))).toBe(shapeOf(typed));

        const loaded = load(`- [x] &#${code};\n- b`);

        expectSaveKeepsDocument(loaded, 'the load');

        lexicalOf(loaded).update(() => {
            const box = $dfs($getRoot()).map(({ node }) => node).find($isMarkdownTaskCheckboxNode)!;

            box.setChecked(false);
        }, { discrete: true });

        expectSaveKeepsDocument(loaded, 'the toggle');
        expect(shapeOf(load(loaded.getValue()))).toBe(shapeOf(loaded));
        expect(loaded.getValue()).toMatch(/^- \[ \] /);
    });

    it('taskBlankTextState refuses a reference that shows a character (pasted JSON)', () => {
        expect(taskBlankTextState.parse('&#65;')).toBe('');
        expect(taskBlankTextState.parse('&#32;')).toBe('&#32;');
        expect(BLANK_REFERENCES.test('&#65;')).toBe(false);
        expect(BLANK_REFERENCES.test('&#12288;')).toBe(false);
        expect(BLANK_REFERENCES.test('&#xA0;')).toBe(false);
        expect(BLANK_REFERENCES.test('&#32; &#9;&#x20;')).toBe(true);
    });

    // Each character reference that shows as blank text after the marker, toggled: the save reloads as the editor shows
    // it and the viewer reads it the same way.
    const REFERENCES = ['&#32;', '&#x20;', '&#X20;', '&#032;', '&#9;', '&#x9;', '&#32;&#32;', '&#32; &#32;', '&#10;', '&#13;'];

    it.each(REFERENCES.flatMap((reference) => [`- [x] ${reference}`, `- [ ] ${reference}`, `- a\n  - [x] ${reference}\n- b`]))(
        'toggled, %j stays a checkbox through a save and a load', (source) => {
            const editor = load(source);

            lexicalOf(editor).update(() => {
                const box = $dfs($getRoot()).map(({ node }) => node).find($isMarkdownTaskCheckboxNode)!;

                box.setChecked(!box.isChecked());
            }, { discrete: true });

            expect(shapeOf(editor)).toMatch(/checkbox\((un)?checked\)/);
            expectSaveKeepsDocument(editor, 'the toggle');
        },
    );
});
