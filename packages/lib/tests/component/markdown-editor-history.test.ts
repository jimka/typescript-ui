// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// MarkdownEditor's undo steps around a paste, a cut and a drop
// (plans/markdown-editor-paste-undo-merge.md): one undo after any of them
// puts the document and the selection back as they were just before it and
// takes back nothing else, also when the paste put back the very text it
// replaced.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createParagraphNode, $createRangeSelection, $createTextNode, $getRoot, $getSelection, $getTextPointCaret, $isRangeSelection,
    $isTextNode, $setSelection, $splitAtPointCaretNext, CONTROLLED_TEXT_INSERTION_COMMAND, IS_BOLD, PASTE_COMMAND, REDO_COMMAND, UNDO_COMMAND,
    createEditor,
} from 'lexical';
import type { LexicalEditor, TextNode } from 'lexical';
import {
    $generateJSONFromSelectedNodes, $generateNodesFromSerializedNodes, $getLexicalContent, $insertGeneratedNodes,
} from '@lexical/clipboard';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { registerMarkdownHistory } from '~/component/editor/markdownHistory';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const TWO = 'alpha beta\n\nomega';
const COLUMNS = '::: columns\nw0 w1\n|||\nw2 w3\n:::\n\nomega';
const BETAS = 'beta one\n\nbeta two\n\nomega';
const RAW = 'alpha\n\n<!--\nabcd\n\nefgh\n-->\n\nomega';

beforeEach(() => {
    installTestDOM(CONFIG);

    // `registerRichText`'s paste handler tells clipboard, drag, input and key events apart by class name.
    vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
    vi.stubGlobal('DragEvent', class DragEvent {});
    vi.stubGlobal('InputEvent', class InputEvent {});
    vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});
});
afterEach(() => {
    DOM.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** Nodes copied as Lexical's clipboard serializes them. */
type CopiedNodes = Parameters<typeof $generateNodesFromSerializedNodes>[0];

/** A point in the document: the exact text of a text node, and an offset in it. */
type TextPoint = readonly [text: string, offset: number];

/** What an undo must restore: the saved Markdown, the whole document state, and the selection. */
interface Snapshot { value: string; state: string; selection: string }

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
 * Runs `edit` as one discrete update of the editor's document.
 *
 * @param editor - The editor.
 * @param edit - The edit; runs inside `editor.update`.
 */
function update(editor: MarkdownEditor, edit: () => void): void {
    lexicalOf(editor).update(edit, { discrete: true });
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
 * Selects from `anchor` to `focus`, each a text point; one point places a
 * caret.
 *
 * @param editor - The editor.
 * @param anchor - The anchor.
 * @param focus - The focus.
 */
function selectText(editor: MarkdownEditor, anchor: TextPoint, focus: TextPoint = anchor): void {
    update(editor, () => {
        const selection = $createRangeSelection();

        selection.anchor.set($textNode(anchor[0]).getKey(), anchor[1], 'text');
        selection.focus.set($textNode(focus[0]).getKey(), focus[1], 'text');
        $setSelection(selection);
    });
}

/**
 * Copies the selection as Lexical's clipboard does.
 *
 * @param editor - The editor.
 * @returns The copied nodes.
 */
function copySelection(editor: MarkdownEditor): CopiedNodes {
    const lexical = lexicalOf(editor);

    return lexical.read(() => $generateJSONFromSelectedNodes(lexical, $getSelection()).nodes);
}

/**
 * Pastes copied nodes at the selection as Lexical's clipboard does, through
 * `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND`.
 *
 * @param editor - The editor.
 * @param nodes - The copied nodes.
 */
function pasteNodes(editor: MarkdownEditor, nodes: CopiedNodes): void {
    const lexical = lexicalOf(editor);

    update(editor, () => {
        $insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(nodes), $getSelection()!);
    });
}

/**
 * Loads `source`, then types `x` at the end of `omega`: the edit a merged
 * step would take back.
 *
 * @param source - The Markdown to load; holds a paragraph `omega`.
 * @returns The editor.
 */
function loadAndType(source: string): MarkdownEditor {
    const editor = load(source);

    selectText(editor, ['omega', 5]);
    lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');
    editor.getValue();   // commits the typing, so the history has recorded it

    return editor;
}

/**
 * Reads the editor's {@link Snapshot}; the selection reads
 * `"text"@offset>"text"@offset`, anchor first.
 *
 * @param editor - The editor.
 * @returns The snapshot.
 */
function snapshot(editor: MarkdownEditor): Snapshot {
    const lexical = lexicalOf(editor);
    const value = editor.getValue();

    return lexical.read(() => {
        const selection = $getSelection();
        const point = (key: string, offset: number): string => {
            const node = $dfs($getRoot()).find((entry) => entry.node.getKey() === key)!.node;

            return `${$isTextNode(node) ? JSON.stringify(node.getTextContent()) : node.getType()}@${offset}`;
        };

        return {
            value,
            state:     JSON.stringify(lexical.getEditorState().toJSON()),
            selection: $isRangeSelection(selection)
                ? `${point(selection.anchor.key, selection.anchor.offset)}>${point(selection.focus.key, selection.focus.offset)}`
                : String(selection),
        };
    });
}

/**
 * Undoes once and reads the result.
 *
 * @param editor - The editor.
 * @returns The snapshot after the undo.
 */
function undo(editor: MarkdownEditor): Snapshot {
    lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

    return snapshot(editor);
}

/**
 * A native paste: `PASTE_COMMAND` carrying plain `text`, and Lexical's own
 * clipboard string when `content` is given.
 *
 * @param editor - The editor.
 * @param text - The clipboard's plain text.
 * @param content - Lexical's clipboard string, or `''` for none.
 */
function nativePaste(editor: MarkdownEditor, text: string, content: string = ''): void {
    const lexical = lexicalOf(editor);
    const event = Object.assign(new ClipboardEvent('paste'), {
        clipboardData: {
            types:   content === '' ? ['text/plain'] : ['application/x-lexical-editor', 'text/plain'],
            files:   [],
            getData: (type: string) => (type === 'application/x-lexical-editor' ? content : type === 'text/plain' ? text : ''),
        },
        preventDefault: () => {},
    });

    update(editor, () => { lexical.dispatchCommand(PASTE_COMMAND, event); });
}

/**
 * Makes `paste()` read `text` from the clipboard.
 *
 * @param text - The clipboard's text.
 */
function clipboardHolds(text: string): void {
    vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue(text);
}

/**
 * Places the caret on the empty line of {@link RAW}'s raw Markdown block,
 * between the line breaks after `abcd`.
 *
 * @param editor - The editor, holding {@link RAW}.
 */
function selectEmptyRawLine(editor: MarkdownEditor): void {
    update(editor, () => {
        const text = $textNode('abcd');
        const selection = $createRangeSelection();
        const offset = text.getIndexWithinParent() + 2;

        selection.anchor.set(text.getParentOrThrow().getKey(), offset, 'element');
        selection.focus.set(text.getParentOrThrow().getKey(), offset, 'element');
        $setSelection(selection);
    });
}

/**
 * A bare Lexical editor after three updates: `abc` is written, edited to
 * `abcd`, then an update only marks that text node dirty and adds an empty
 * paragraph — one dirty leaf, text as before, document changed.
 *
 * @param register - Registers the history under test on the editor.
 * @returns The editor, and a reader of the text of each block.
 */
function bareEditorAfterBlockAddingUpdate(register: (editor: LexicalEditor) => void): { editor: LexicalEditor; blocks: () => string[] } {
    const editor = createEditor({ onError: (error) => { throw error; } });
    let text!: TextNode;

    register(editor);
    editor.update(() => {
        text = $createTextNode('abc');
        $getRoot().append($createParagraphNode().append(text));
    }, { discrete: true });
    editor.update(() => { text.setTextContent('abcd'); }, { discrete: true });
    editor.update(() => {
        text.markDirty();
        $getRoot().append($createParagraphNode());
    }, { discrete: true });

    return { editor, blocks: () => editor.read(() => $getRoot().getChildren().map((child) => child.getTextContent())) };
}

describe('a paste is one undo step (P rows)', () => {
    it('P1: a selection across two columns pasted over itself is undone alone, redone, and undone again', () => {
        const editor = loadAndType(COLUMNS);

        selectText(editor, ['w0 w1', 4], ['w2 w3', 0]);

        const nodes = copySelection(editor);

        selectText(editor, ['w2 w3', 0], ['w0 w1', 4]);

        const before = snapshot(editor);

        pasteNodes(editor, nodes);

        const after = snapshot(editor);

        expect(undo(editor)).toEqual(before);

        lexicalOf(editor).dispatchCommand(REDO_COMMAND, undefined);
        expect(snapshot(editor).state).toBe(after.state);

        expect(undo(editor)).toEqual(before);
        expect(undo(editor).value).toBe(COLUMNS);
    });

    it('P2: the same paste made as a native paste is undone alone', () => {
        const editor = loadAndType(COLUMNS);
        const lexical = lexicalOf(editor);

        selectText(editor, ['w0 w1', 4], ['w2 w3', 0]);

        const content = lexical.read(() => $getLexicalContent(lexical) ?? '');

        selectText(editor, ['w2 w3', 0], ['w0 w1', 4]);

        const before = snapshot(editor);

        nativePaste(editor, '1\n', content);

        expect(undo(editor)).toEqual(before);
        expect(undo(editor).value).toBe(COLUMNS);
    });

    it('P3: the same paste with no edit before it is undone', () => {
        const editor = load(COLUMNS);

        selectText(editor, ['w0 w1', 4], ['w2 w3', 0]);

        const nodes = copySelection(editor);

        selectText(editor, ['w2 w3', 0], ['w0 w1', 4]);

        const before = snapshot(editor);

        pasteNodes(editor, nodes);

        expect(undo(editor)).toEqual(before);
    });

    it('P4: a word pasted over itself is undone alone, and the word is selected again', () => {
        const editor = loadAndType(TWO);

        selectText(editor, ['alpha beta', 6], ['alpha beta', 10]);

        const before = snapshot(editor);

        nativePaste(editor, 'beta');

        const after = snapshot(editor);

        expect(after.value).toBe('alpha beta\n\nomegax');
        expect(after.selection).toBe('"alpha beta"@10>"alpha beta"@10');
        expect(before.selection).toBe('"alpha beta"@6>"alpha beta"@10');
        expect(undo(editor)).toEqual(before);
        expect(undo(editor).value).toBe(TWO);
    });

    it('P5: a word pasted over itself with paste() is undone alone', async () => {
        const editor = loadAndType(TWO);

        selectText(editor, ['alpha beta', 6], ['alpha beta', 10]);

        const before = snapshot(editor);

        clipboardHolds('beta');
        await editor.paste();

        expect(snapshot(editor).value).toBe('alpha beta\n\nomegax');
        expect(undo(editor)).toEqual(before);
        expect(undo(editor).value).toBe(TWO);
    });

    it('P6: a word pasted over the same word of another paragraph is undone alone', () => {
        const editor = loadAndType(BETAS);

        selectText(editor, ['beta two', 0], ['beta two', 4]);

        const before = snapshot(editor);

        nativePaste(editor, 'beta');

        expect(snapshot(editor).value).toBe('beta one\n\nbeta two\n\nomegax');
        expect(undo(editor)).toEqual(before);
        expect(undo(editor).value).toBe(BETAS);
    });

    it('P7: two pastes in a row are two steps', () => {
        const editor = loadAndType(TWO);

        selectText(editor, ['alpha beta', 10]);
        nativePaste(editor, 'ONE');
        nativePaste(editor, 'TWO');

        expect(snapshot(editor).value).toBe('alpha betaONETWO\n\nomegax');
        expect(undo(editor).value).toBe('alpha betaONE\n\nomegax');
        expect(undo(editor).value).toBe('alpha beta\n\nomegax');
        expect(undo(editor).value).toBe(TWO);
    });

    it('P8: a word selected backwards and pasted over itself is undone alone', () => {
        const editor = loadAndType(TWO);

        selectText(editor, ['alpha beta', 10], ['alpha beta', 6]);

        const before = snapshot(editor);

        nativePaste(editor, 'beta');

        expect(snapshot(editor).selection).toBe('"alpha beta"@10>"alpha beta"@10');
        expect(before.selection).toBe('"alpha beta"@10>"alpha beta"@6');
        expect(undo(editor)).toEqual(before);
        expect(undo(editor).value).toBe(TWO);
    });
});

// Every step of a row runs inside the history's 300 ms window: no row waits.
describe('a paste and the typing around it are separate steps (T rows)', () => {
    it('T1: a native paste right after typing is a step of its own', () => {
        const editor = loadAndType(TWO);

        nativePaste(editor, 'ONE');

        expect(snapshot(editor).value).toBe('alpha beta\n\nomegaxONE');
        expect(undo(editor).value).toBe('alpha beta\n\nomegax');
        expect(undo(editor).value).toBe(TWO);
    });

    it('T2: paste() right after typing is a step of its own', async () => {
        const editor = loadAndType(TWO);

        clipboardHolds('Z');
        await editor.paste();

        expect(snapshot(editor).value).toBe('alpha beta\n\nomegaxZ');
        expect(undo(editor).value).toBe('alpha beta\n\nomegax');
        expect(undo(editor).value).toBe(TWO);
    });

    it('T3: a character typed right after paste() put one character into an empty block is a step of its own', async () => {
        const editor = load(TWO);

        update(editor, () => {
            const empty = $createParagraphNode();

            $getRoot().getFirstChildOrThrow().insertAfter(empty);
            empty.select();
        });
        clipboardHolds('Z');
        await editor.paste();
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'q');

        expect(snapshot(editor).value).toBe('alpha beta\n\nZq\n\nomega');
        expect(undo(editor).value).toBe('alpha beta\n\nZ\n\nomega');
        expect(undo(editor).value).toBe(TWO);
    });

    it('T4: a character typed right after a native paste put one character on an empty line of a raw block is a step of its own', () => {
        const editor = load(RAW);

        selectEmptyRawLine(editor);
        nativePaste(editor, 'Z');
        editor.getValue();   // commits the paste, so the history has recorded it
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'q');

        expect(snapshot(editor).value).toBe('alpha\n\n<!--\nabcd\nZq\nefgh\n-->\n\nomega');
        expect(undo(editor).value).toBe('alpha\n\n<!--\nabcd\nZ\nefgh\n-->\n\nomega');
        expect(undo(editor).value).toBe(RAW);
    });

    it('T5: a native paste of one character right after a character typed on an empty line of a raw block is a step of its own', () => {
        const editor = load(RAW);

        selectEmptyRawLine(editor);
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'q');
        editor.getValue();   // commits the typing, so the history has recorded it
        nativePaste(editor, 'Z');

        expect(snapshot(editor).value).toBe('alpha\n\n<!--\nabcd\nqZ\nefgh\n-->\n\nomega');
        expect(undo(editor).value).toBe('alpha\n\n<!--\nabcd\nq\nefgh\n-->\n\nomega');
        expect(undo(editor).value).toBe(RAW);
    });
});

// A real drop needs a browser: Lexical reads the drop point from the page. D1 and D2 run the updates a drop runs.
describe('a cut and a drop are one undo step (C, D and N rows)', () => {
    it('C1: cut() is undone alone', () => {
        const editor = loadAndType(TWO);

        selectText(editor, ['alpha beta', 0], ['alpha beta', 6]);

        const before = snapshot(editor);

        editor.cut();

        expect(snapshot(editor).value).toBe('beta\n\nomegax');
        expect(undo(editor)).toEqual(before);
        expect(undo(editor).value).toBe(TWO);
    });

    it('D1: a selection dropped at its own end is undone alone', () => {
        const editor = loadAndType(TWO);
        const lexical = lexicalOf(editor);

        selectText(editor, ['alpha beta', 6], ['alpha beta', 10]);

        const nodes = copySelection(editor);
        const before = snapshot(editor);

        update(editor, () => {
            const selection = $getSelection();
            const isRange = $isRangeSelection(selection);

            if (isRange) {
                selection.removeText();
                $insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(nodes), selection);
            }
        });

        expect(snapshot(editor).value).toBe('alpha beta\n\nomegax');
        expect(undo(editor)).toEqual(before);
        expect(undo(editor).value).toBe(TWO);
    });

    it('D2: a drop released inside its own selection leaves no step', () => {
        const editor = loadAndType(TWO);

        selectText(editor, ['alpha beta', 2], ['alpha beta', 8]);
        update(editor, () => { $splitAtPointCaretNext($getTextPointCaret($textNode('alpha beta'), 'next', 5)); });

        expect(snapshot(editor).selection).toBe('"alpha beta"@2>"alpha beta"@8');
        expect(undo(editor).value).toBe(TWO);
    });

    it('N1: an update that changes neither the document nor the selection leaves no step', () => {
        const editor = loadAndType(TWO);

        selectText(editor, ['alpha beta', 2], ['alpha beta', 8]);
        update(editor, () => { $textNode('alpha beta').markDirty(); });

        expect(undo(editor).value).toBe(TWO);
    });

    it('N2: an update that only moves a caret leaves no step', () => {
        const editor = loadAndType(TWO);

        selectText(editor, ['alpha beta', 2]);
        update(editor, () => {
            const text = $textNode('alpha beta');

            text.markDirty();
            text.select(8, 8);
        });

        expect(snapshot(editor).selection).toBe('"alpha beta"@8>"alpha beta"@8');
        expect(undo(editor).value).toBe(TWO);
    });

    it('N3: an update that changes only the text format a kept range carries leaves no step', () => {
        const editor = loadAndType(TWO);

        selectText(editor, ['alpha beta', 2], ['alpha beta', 8]);
        update(editor, () => {
            const selection = $getSelection();
            const isRange = $isRangeSelection(selection);

            $textNode('alpha beta').markDirty();

            if (isRange) {
                selection.setFormat(IS_BOLD);
                selection.setStyle('color: red');
            }
        });

        expect(snapshot(editor).selection).toBe('"alpha beta"@2>"alpha beta"@8');
        expect(undo(editor).value).toBe(TWO);
    });
});

describe('source mode is unaffected (S row)', () => {
    it('S1: paste() in source mode is the source editor\'s own paste', async () => {
        const editor = new MarkdownEditor('hello', { mode: 'source' });
        const sourcePaste = vi.spyOn((editor as unknown as { _codeEditor: { paste(): Promise<boolean> } })._codeEditor, 'paste').mockResolvedValue(true);
        const read = vi.spyOn(DOM.source, 'readClipboardText');

        await expect(editor.paste()).resolves.toBe(true);
        expect(sourcePaste).toHaveBeenCalledTimes(1);
        expect(read).not.toHaveBeenCalled();
    });
});

describe('the upstream rule and the guard on a bare editor (K rows)', () => {
    // When this fails after a Lexical upgrade, `@lexical/history` no longer
    // merges an update on the strength of one unchanged text leaf — delete the
    // proxy in `markdownHistory.ts` (call `registerHistory` with the editor
    // itself) and this canary.
    it('K1 (canary): @lexical/history merges an update that added a block when its one dirty leaf reads as before', () => {
        const history = createEmptyHistoryState();
        const { editor, blocks } = bareEditorAfterBlockAddingUpdate((bare) => { registerHistory(bare, history, 300); });

        expect(blocks()).toEqual(['abcd', '']);
        expect(history.undoStack).toHaveLength(1);

        editor.dispatchCommand(UNDO_COMMAND, undefined);

        expect(blocks()).toEqual(['abc']);
    });

    it('K2: the guarded history makes that update a step of its own', () => {
        const { editor, blocks } = bareEditorAfterBlockAddingUpdate((bare) => { registerMarkdownHistory(bare, () => false); });

        expect(blocks()).toEqual(['abcd', '']);

        editor.dispatchCommand(UNDO_COMMAND, undefined);

        expect(blocks()).toEqual(['abcd']);

        editor.dispatchCommand(UNDO_COMMAND, undefined);

        expect(blocks()).toEqual(['abc']);
    });
});
