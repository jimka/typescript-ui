// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $addUpdateTag, $createRangeSelection, $getRoot, $getState, $isElementNode, $isTextNode, $setCompositionKey, $setSelection, COMPOSITION_END_TAG, COMPOSITION_START_TAG, CONTROLLED_TEXT_INSERTION_COMMAND,
    DELETE_CHARACTER_COMMAND, FORMAT_TEXT_COMMAND, INDENT_CONTENT_COMMAND, INSERT_LINE_BREAK_COMMAND, INSERT_PARAGRAPH_COMMAND, OUTDENT_CONTENT_COMMAND, PASTE_COMMAND,
    REDO_COMMAND, UNDO_COMMAND,
} from 'lexical';
import type { LexicalEditor, LexicalNode } from 'lexical';
import { $isListItemNode, $isListNode } from '@lexical/list';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { listLooseState } from '~/component/editor/markdownNodeState';
import { $createMarkdownRawBlockNode } from '~/component/editor/markdownSourceNodes';
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

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

function load(source: string): MarkdownEditor {
    const editor = new MarkdownEditor();

    editor.setValue(source);

    return editor;
}

/** The document as a tree: each text as written, each list with its looseness, each block with an indent it carries. */
function tree(node: LexicalNode): string {
    const isText = $isTextNode(node);
    const isList = $isListNode(node);
    const isElement = $isElementNode(node);

    if (isText) {
        return JSON.stringify(node.getTextContent());
    }

    if (isList) {
        const looseness = $getState(node, listLooseState) ? 'loose' : 'tight';

        return `${looseness}(${node.getChildren().map(tree).join(', ')})`;
    }

    if (isElement) {
        const isIndented = !$isListItemNode(node) && node.getType() !== 'markdown-list-item-text' && node.getIndent() !== 0;

        return `${node.getType()}${isIndented ? '[indented]' : ''}(${node.getChildren().map(tree).join(', ')})`;
    }

    return node.getType();
}

function shown(editor: MarkdownEditor): string {
    return lexicalOf(editor).read(() => $getRoot().getChildren().map(tree).join(' | '));
}

/** Selects from `offset` in the text node reading `from` to `toOffset` in the one reading `to`; `-1` is a text's end. */
function select(editor: MarkdownEditor, from: string, offset: number, to: string = from, toOffset: number = offset): void {
    lexicalOf(editor).update(() => {
        const texts = $getRoot().getAllTextNodes();
        const anchor = texts.find((node) => node.getTextContent() === from)!;
        const focus = texts.find((node) => node.getTextContent() === to)!;
        const selection = $createRangeSelection();

        selection.anchor.set(anchor.getKey(), offset < 0 ? anchor.getTextContentSize() : offset, 'text');
        selection.focus.set(focus.getKey(), toOffset < 0 ? focus.getTextContentSize() : toOffset, 'text');
        $setSelection(selection);
    }, { discrete: true });
}

function type(editor: MarkdownEditor, text: string): void {
    lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, text);
}

function deleteSelection(editor: MarkdownEditor): void {
    lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
}

/** Checks what the editor shows and saves, and that a load of the save shows the same. */
function expectShownAndReloaded(editor: MarkdownEditor, expectedTree: string, expectedSave: string): void {
    const saved = editor.getValue();

    expect(shown(editor)).toBe(expectedTree);
    expect(saved).toBe(expectedSave);
    expect(shown(load(saved))).toBe(expectedTree);
}

describe('the editor shows what its save reloads to: text typed in the block a raw block of a list item comes to be', () => {
    /** Whether the first list of the editor is loose or tight. */
    function looseness(editor: MarkdownEditor): string {
        return lexicalOf(editor).read(() => ($getState($getRoot().getChildren().find($isListNode)!, listLooseState) ? 'loose' : 'tight'));
    }

    // A raw block that holds nothing but blanks writes nothing, so an edit that leaves one shows an empty paragraph instead
    // (`$showBlankRawBlockAsParagraph`), and the looseness rule for a further paragraph keeps its list as the save reads it.
    it('L1: text typed into the block a raw block emptied leaves makes the list loose', () => {
        const editor = load('- a\n\n  <div>');

        // The raw block's text goes, then a space is typed: the block writes nothing, and its one-item list is tight.
        select(editor, '<div>', 0, '<div>', -1);
        deleteSelection(editor);
        type(editor, ' ');

        expect(looseness(editor)).toBe('tight');
        expect(editor.getValue()).toBe('- a');

        select(editor, ' ', 1);
        type(editor, '<p>');

        expect(looseness(editor)).toBe('loose');
        expect(editor.getValue()).toBe('- a\n\n  \\<p>');
        expect(looseness(load(editor.getValue()))).toBe('loose');
    });

    it('L2: the same in a list of several items, whose save then sets its items apart', () => {
        const editor = load('- a\n- b\n- c');

        lexicalOf(editor).update(() => {
            const item = $getRoot().getAllTextNodes()[0]!.getParents().find($isListItemNode)!;

            item.append($createMarkdownRawBlockNode(' '));
        }, { discrete: true });
        select(editor, ' ', 1);
        type(editor, '<div>');

        expect(looseness(editor)).toBe('loose');
        expect(editor.getValue()).toBe('- a\n\n  \\<div>\n\n- b\n\n- c');
        expect(looseness(load(editor.getValue()))).toBe('loose');
    });

    it('L3: a raw block deleted down to a space leaves its one-item list tight', () => {
        const editor = load('- a\n\n  <div>');

        select(editor, '<div>', -1);
        type(editor, ' ');
        select(editor, '<div> ', 0, '<div> ', 5);
        deleteSelection(editor);

        expect(looseness(editor)).toBe('tight');
        expect(editor.getValue()).toBe('- a');
        expect(looseness(load(editor.getValue()))).toBe('tight');
    });

    it('L4: a letter typed in a raw block that already writes changes no looseness', () => {
        const editor = load('- a\n\n  <div>\n- b');

        select(editor, '<div>', 5);
        type(editor, 'x');

        expectShownAndReloaded(editor, 'loose(markdown-list-item(markdown-list-item-text("a"), markdown-raw-block("<div>x")), markdown-list-item(markdown-list-item-text("b")))', '- a\n\n  <div>x\n\n- b');
    });
});

describe('the editor shows what its save reloads to: a line break in a table cell', () => {
    const TABLE = '| t0 |\n| --- |\n| t1 |';
    const cells = (...body: string[]): string => `table(tablerow(tablecell(paragraph("t0"))), tablerow(tablecell(${body.join(', ')})))`;

    it('C1: Shift+Enter inside a cell keeps a line break, saved as <br>', () => {
        const editor = load(TABLE);

        select(editor, 't1', 1);
        lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

        expectShownAndReloaded(editor, cells('paragraph("t", linebreak, "1")'), '| t0 |\n| --- |\n| t<br>1 |');
    });

    it('C2: text typed after Shift+Enter at a cell\'s end follows the break, and two undos give the cell back', () => {
        const editor = load(TABLE);

        select(editor, 't1', -1);
        lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
        type(editor, 'y');

        expectShownAndReloaded(editor, cells('paragraph("t1", linebreak, "y")'), '| t0 |\n| --- |\n| t1<br>y |');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(TABLE);
    });

    it('C3: Shift+Enter in a paragraph outside a table still makes a hard break', () => {
        const editor = load('ab');

        select(editor, 'ab', 1);
        lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

        expectShownAndReloaded(editor, 'paragraph("a", linebreak, "b")', 'a\\\nb');
    });

    it('C4: Enter inside a cell still makes a new paragraph of the cell, saved as the cell paragraph break', () => {
        const editor = load(TABLE);

        select(editor, 't1', 1);
        lexicalOf(editor).dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);

        expectShownAndReloaded(editor, cells('paragraph("t")', 'paragraph("1")'), '| t0 |\n| --- |\n| t\\n\\n1 |');
    });

    it.each([
        ['<br>'], ['<br/>'], ['<br />'], ['<BR>'],
    ])('C5: a cell\'s %s loads as a line break, and an edit of the cell saves it as <br>', (tag) => {
        const source = `| t0 |\n| --- |\n| a${tag}b |`;
        const editor = load(source);

        expect(shown(editor)).toBe(cells('paragraph("a", linebreak, "b")'));
        expect(editor.getValue()).toBe(source);

        select(editor, 'b', 1);
        type(editor, 'x');

        expectShownAndReloaded(editor, cells('paragraph("a", linebreak, "bx")'), '| t0 |\n| --- |\n| a<br>bx |');
    });

    it.each([
        ['in a code span of a cell', '| t0 |\n| --- |\n| `a<br>b` |', cells('paragraph("a<br>b")')],
        ['escaped in a cell', '| t0 |\n| --- |\n| a\\<br>b |', cells('paragraph("a<br>b")')],
        ['outside a table', 'a<br>b', 'paragraph("a", "<br>", "b")'],
    ])('C6: a <br> %s stays text', (_name, source, expectedTree) => {
        const editor = load(source);

        expect(shown(editor)).toBe(expectedTree);
        expect(editor.getValue()).toBe(source);
    });

    it('C7: the text <br> typed into a cell is saved escaped and reloads as text', () => {
        const editor = load(TABLE);

        select(editor, 't1', 1);
        type(editor, '<br>');

        expectShownAndReloaded(editor, cells('paragraph("t<br>1")'), '| t0 |\n| --- |\n| t\\<br>1 |');
    });
});

describe('the editor shows what its save reloads to: a line end inside a text', () => {
    it('N1: a code block of two lines made a paragraph holds a line break', () => {
        const editor = load('```\na\nb\n```');

        lexicalOf(editor).update(() => { $getRoot().getAllTextNodes()[0]!.select(1, 1); }, { discrete: true });
        editor.setBlockType('paragraph');

        expectShownAndReloaded(editor, 'paragraph("a", linebreak, "b")', 'a\\\nb');
    });

    it('N2: a code block of two lines made a list item holds a line break', () => {
        const editor = load('```\na\nb\n```');

        lexicalOf(editor).update(() => { $getRoot().getAllTextNodes()[0]!.select(1, 1); }, { discrete: true });
        editor.toggleUnorderedList();

        expectShownAndReloaded(editor, 'tight(markdown-list-item(markdown-list-item-text("a", linebreak, "b")))', '- a\\\n  b');
    });

    it('N3: a code block keeps its line ends as text', () => {
        const editor = load('```\na\nb\n```');

        lexicalOf(editor).update(() => { $getRoot().getAllTextNodes()[0]!.select(1, 1); }, { discrete: true });
        type(editor, 'x');

        expectShownAndReloaded(editor, 'code("axb")'.replace('axb', 'ax\\nb'), '```\nax\nb\n```');
    });
});

describe('the editor shows what its save reloads to: an indent', () => {
    it('I1: the indent command leaves a paragraph as it is, and adds no undo step', () => {
        const editor = load('p0\n\np1');

        select(editor, 'p1', 1);
        type(editor, 'x');
        lexicalOf(editor).dispatchCommand(INDENT_CONTENT_COMMAND, undefined);

        expectShownAndReloaded(editor, 'paragraph("p0") | paragraph("px1")', 'p0\n\npx1');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe('p0\n\np1');
    });

    it('I2: over a list item and a paragraph it moves the item alone, in one undo step', () => {
        const editor = load('- a\n- b\n\np0');

        select(editor, 'b', 1, 'p0', 1);
        lexicalOf(editor).dispatchCommand(INDENT_CONTENT_COMMAND, undefined);

        expectShownAndReloaded(editor, 'tight(markdown-list-item(markdown-list-item-text("a"), tight(markdown-list-item(markdown-list-item-text("b"))))) | paragraph("p0")', '- a\n  - b\n\np0');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe('- a\n- b\n\np0');
    });

    it('I3: a further paragraph of an item takes none either', () => {
        const editor = load('- a\n\n  more\n- b');

        select(editor, 'more', 1);
        lexicalOf(editor).dispatchCommand(INDENT_CONTENT_COMMAND, undefined);

        expectShownAndReloaded(editor, 'loose(markdown-list-item(markdown-list-item-text("a"), paragraph("more")), markdown-list-item(markdown-list-item-text("b")))', '- a\n\n  more\n- b');
    });

    it('I4: the indent and outdent of a list item move it as before', () => {
        const editor = load('- a\n- b');

        select(editor, 'b', 1);
        lexicalOf(editor).dispatchCommand(INDENT_CONTENT_COMMAND, undefined);

        expect(editor.getValue()).toBe('- a\n  - b');

        lexicalOf(editor).dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);

        expect(editor.getValue()).toBe('- a\n- b');
    });
});

/** Pastes plain text at the selection, as Ctrl/Cmd+V does with a clipboard holding only text. */
function pasteText(editor: MarkdownEditor, text: string): void {
    const data: Record<string, string> = { 'text/plain': text };

    // `registerRichText`'s paste handler tells clipboard, drag, input and key events apart by class name.
    vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
    vi.stubGlobal('DragEvent', class DragEvent {});
    vi.stubGlobal('InputEvent', class InputEvent {});
    vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});
    lexicalOf(editor).update(() => {
        lexicalOf(editor).dispatchCommand(PASTE_COMMAND, Object.assign(new ClipboardEvent('paste'), {
            clipboardData: { types: Object.keys(data), files: [], getData: (type: string) => data[type] ?? '' }, preventDefault: () => {},
        }));
    }, { discrete: true });
    vi.unstubAllGlobals();
}

describe('the editor shows what its save reloads to: whitespace at a line\'s start', () => {
    it('W1: a space typed at a paragraph\'s start stays until the next character, which takes its place', () => {
        const editor = load('p0');

        select(editor, 'p0', 0);
        type(editor, ' ');

        expect(shown(editor)).toBe('paragraph(" p0")');

        type(editor, 'x');

        expectShownAndReloaded(editor, 'paragraph("xp0")', 'xp0');

        type(editor, 'y');

        expect(shown(editor)).toBe('paragraph("xyp0")');
    });

    it('W2: spaces and a tab typed one after another stay together, and go together', () => {
        const editor = load('p0');

        select(editor, 'p0', 0);
        type(editor, ' ');
        type(editor, ' ');
        type(editor, '\t');

        expect(shown(editor)).toBe('paragraph("  \\tp0")');

        type(editor, 'x');

        expectShownAndReloaded(editor, 'paragraph("xp0")', 'xp0');
    });

    it.each([
        ['a heading', '# h0', 'h0', 'heading("xh0")', '# xh0'],
        ['a quote', '> q0', 'q0', 'quote("xq0")', '> xq0'],
        ['a list item', '- i0', 'i0', 'tight(markdown-list-item(markdown-list-item-text("xi0")))', '- xi0'],
        ['a task item, after its marker', '- [ ] t0', 't0', 'tight(markdown-list-item(markdown-list-item-text("[ ] ", "xt0")))', '- [ ] xt0'],
        ['a further paragraph of an item', '- a\n\n  m0', 'm0', 'loose(markdown-list-item(markdown-list-item-text("a"), paragraph("xm0")))', '- a\n\n  xm0'],
        ['a line after a hard break', 'a\\\nb0', 'b0', 'paragraph("a", linebreak, "xb0")', 'a\\\nxb0'],
        ['a line after a soft break', 'a\nb0', 'b0', 'paragraph("a", " ", "xb0")', 'a\nxb0'],
        ['a table cell', '| t0 |\n| --- |\n| c0 |', 'c0', 'table(tablerow(tablecell(paragraph("t0"))), tablerow(tablecell(paragraph("xc0"))))', '| t0 |\n| --- |\n| xc0 |'],
        ['a cell\'s second paragraph', '| t0 |\n| --- |\n| a\\n\\nc0 |', 'c0', 'table(tablerow(tablecell(paragraph("t0"))), tablerow(tablecell(paragraph("a"), paragraph("xc0"))))', '| t0 |\n| --- |\n| a\\n\\nxc0 |'],
    ])('W3: the same at the start of %s', (_name, source, text, expectedTree, expectedSave) => {
        const editor = load(source);

        select(editor, text, 0);
        type(editor, ' ');
        type(editor, 'x');

        expectShownAndReloaded(editor, expectedTree, expectedSave);
    });

    it.each([
        ['a code block', '```\nc0\n```', 'c0', 'code(" xc0")', '```\n xc0\n```'],
        ['a cell\'s line after a <br>', '| t0 |\n| --- |\n| a<br>c0 |', 'c0', 'table(tablerow(tablecell(paragraph("t0"))), tablerow(tablecell(paragraph("a", linebreak, " xc0"))))', '| t0 |\n| --- |\n| a<br> xc0 |'],
        ['the middle of a line', 'a0', 'a0', 'paragraph("a x0")', 'a x0'],
    ])('W4: whitespace the save keeps stays: %s', (_name, source, text, expectedTree, expectedSave) => {
        const editor = load(source);

        select(editor, text, text === 'a0' ? 1 : 0);
        type(editor, ' ');
        type(editor, 'x');

        expectShownAndReloaded(editor, expectedTree, expectedSave);
    });

    it('W5: a no-break space at a paragraph\'s start is no whitespace the save drops, and stays', () => {
        const editor = load('p0');

        select(editor, 'p0', 0);
        type(editor, ' ');
        type(editor, 'x');

        expectShownAndReloaded(editor, 'paragraph(" xp0")', ' xp0');
    });

    it('W6: the next character typed anywhere in the block takes the space away', () => {
        const editor = load('p0');

        select(editor, 'p0', 0);
        type(editor, ' ');
        select(editor, ' p0', -1);
        type(editor, 'y');

        expectShownAndReloaded(editor, 'paragraph("p0y")', 'p0y');
    });

    it('W7: a space an edit leaves at a line\'s start with the caret before it stays, and text typed there keeps it inside the line', () => {
        const editor = load('a b0');

        select(editor, 'a b0', 1);
        lexicalOf(editor).dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);

        expect(shown(editor)).toBe('paragraph("a") | paragraph(" b0")');

        type(editor, 'x');

        expectShownAndReloaded(editor, 'paragraph("a") | paragraph("x b0")', 'a\n\nx b0');
    });

    it('W11: text typed over a range from one block into another keeps the space after the range', () => {
        const editor = load('w2\n\nx y');

        select(editor, 'w2', 0, 'x y', 1);
        type(editor, 'z');

        expectShownAndReloaded(editor, 'paragraph("z y")', 'z y');
    });

    it('W12: a pasted line that opens with a tab loses it once the caret has passed it', () => {
        const editor = load('p0');

        select(editor, 'p0', 0);
        pasteText(editor, '\tx');

        expectShownAndReloaded(editor, 'paragraph("xp0")', 'xp0');
    });

    /**
     * Runs `body` with a clock the test drives: the history merges what is typed within its delay of the update before,
     * so the time between two keys decides what one undo takes back.
     *
     * @param body - What to run, given the function that moves the clock on by some milliseconds.
     */
    function withClock(body: (wait: (ms: number) => void) => void): void {
        let clock = 1_700_000_000_000;
        const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock);

        try {
            body((ms) => { clock += ms; });
        } finally {
            spy.mockRestore();
        }
    }

    /** Types one character and commits its update, as a browser does for each key. */
    function typeKey(editor: MarkdownEditor, text: string): void {
        type(editor, text);
        shown(editor);
    }

    /** Dispatches a command and commits its update. */
    function command(editor: MarkdownEditor, kind: Parameters<LexicalEditor['dispatchCommand']>[0], payload?: unknown): void {
        lexicalOf(editor).dispatchCommand(kind, payload as never);
        shown(editor);
    }

    /** Selects characters `from` to `to` of the first text of the document. */
    function selectInFirstText(editor: MarkdownEditor, from: number, to: number): void {
        lexicalOf(editor).update(() => { $getRoot().getAllTextNodes()[0]!.select(from, to); }, { discrete: true });
    }

    /** Moves the caret to the end of the document's text. */
    function caretToEnd(editor: MarkdownEditor): void {
        lexicalOf(editor).update(() => { $getRoot().selectEnd(); }, { discrete: true });
    }

    /** Types the letters one by one, `gap` milliseconds apart, each committed on its own. */
    function keys(editor: MarkdownEditor, wait: (ms: number) => void, gap: number, ...letters: string[]): void {
        letters.forEach((letter, index) => {
            if (index > 0) {
                wait(gap);
            }

            typeKey(editor, letter);
        });
    }

    /**
     * How many undo steps the editor holds: undoes until the document stops changing, a second apart.
     *
     * @returns The number of undos that changed the document.
     */
    function undoSteps(editor: MarkdownEditor, wait: (ms: number) => void): number {
        const state = (): string => `${shown(editor)} ${editor.getValue()}`;
        let steps = 0;
        let last = state();

        for (;;) {
            wait(1000);
            command(editor, UNDO_COMMAND);

            const now = state();

            if (now === last) {
                return steps;
            }

            steps += 1;
            last = now;
        }
    }

    type TypingScript = (editor: MarkdownEditor, first: string, wait: (ms: number) => void) => void;

    /**
     * The undo steps of a typing script, run with `first` as the character typed at the start: a space, which the
     * editor removes at the next keystroke, or `w`, which it does not. Typing merges as the history's own rules say,
     * so the two must give the same number.
     */
    function stepsOf(script: TypingScript, first: string, source = 'p0'): number {
        let steps = 0;

        withClock((wait) => {
            const editor = load(source);

            selectInFirstText(editor, 0, 0);
            script(editor, first, wait);
            steps = undoSteps(editor, wait);
        });

        return steps;
    }

    const SCRIPTS: Array<[string, TypingScript, number | null]> = [
        ['a space and three letters typed 10 ms apart', (e, first, wait) => { keys(e, wait, 10, first, 'x', 'y', 'z'); }, 1],
        ['a letter typed more than the delay after the space, then two more', (e, first, wait) => {
            typeKey(e, first); wait(400); keys(e, wait, 10, 'x', 'y', 'z');
        }, 2],
        ['a keystroke more than the delay after the one before', (e, first, wait) => {
            typeKey(e, first); wait(10); typeKey(e, 'x'); wait(310); keys(e, wait, 10, 'y', 'z');
        }, 2],
        ['typing after a pause and a caret move', (e, first, wait) => {
            typeKey(e, first); wait(2000); caretToEnd(e); wait(50); keys(e, wait, 10, 'x', 'y', 'z');
        }, 2],
        ['typing after a paste', (e, first, wait) => {
            pasteText(e, first); wait(50); keys(e, wait, 10, 'x', 'y');
        }, 2],
        ['typing into the empty paragraph Enter made', (e, first, wait) => {
            selectInFirstText(e, 2, 2); command(e, INSERT_PARAGRAPH_COMMAND); wait(1000); keys(e, wait, 10, first, 'x', 'y');
        }, 2],
        ['a dead key composed after the first key, then typing', (e, first, wait) => {
            typeKey(e, first); wait(50);
            lexicalOf(e).update(() => {
                const text = $getRoot().getAllTextNodes()[0]!;

                $addUpdateTag(COMPOSITION_START_TAG);
                $setCompositionKey(text.getKey());
                text.spliceText(1, 0, '´', true);
            }, { discrete: true });
            wait(50);
            lexicalOf(e).update(() => {
                const text = $getRoot().getAllTextNodes()[0]!;

                $addUpdateTag(COMPOSITION_END_TAG);
                $setCompositionKey(null);
                text.spliceText(1, 1, 'é', true);
            }, { discrete: true });
            shown(e); wait(10); keys(e, wait, 10, 'x', 'y');
        }, 1],
        ['Shift+Enter after the first key, then typing', (e, first, wait) => {
            typeKey(e, first); wait(50); command(e, INSERT_LINE_BREAK_COMMAND, false); wait(50); keys(e, wait, 10, 'q', 'r');
        }, 3],
        ['Enter after the first key, then typing', (e, first, wait) => {
            typeKey(e, first); wait(50); command(e, INSERT_PARAGRAPH_COMMAND); wait(50); keys(e, wait, 10, 'q', 'r');
        }, 3],
    ];

    it.each(SCRIPTS)('H1: %s: as many undo steps as without the whitespace', (_name, script, expected) => {
        const withSpace = stepsOf(script, ' ');

        expect(withSpace).toBe(stepsOf(script, 'w'));
        expect(withSpace).toBe(expected);
    });

    it.each([
        ['3 s later', 3000],
        ['80 ms later', 80],
    ])('H2: a format toggle %s than a typed space is its own step', (_name, gap) => {
        const script: TypingScript = (e, first, wait) => {
            typeKey(e, first); wait(gap); selectInFirstText(e, 1, 3); wait(80); command(e, FORMAT_TEXT_COMMAND, 'bold');
        };
        const withSpace = stepsOf(script, ' ', 'p0 p1');

        expect(withSpace).toBe(stepsOf(script, 'w', 'p0 p1'));
        expect(withSpace).toBe(2);
    });

    it('H6: typing a space over a range across two paragraphs, then letters, gives as many undo steps as `w`', () => {
        const script = (first: string): number => {
            let steps = 0;

            withClock((wait) => {
                const editor = load('p0\n\np1');

                select(editor, 'p0', 0, 'p1', -1);
                keys(editor, wait, 10, first, 'x', 'y');
                steps = undoSteps(editor, wait);
            });

            return steps;
        };

        expect(script(' ')).toBe(script('w'));
    });

    it('H3: a code block set to a paragraph 100 ms after typing is its own step', () => {
        withClock((wait) => {
            const editor = load('```\na\n  b\n```');

            selectInFirstText(editor, 1, 1);
            keys(editor, wait, 10, 'q', 'r');
            wait(100);
            editor.setBlockType('paragraph');

            expect(shown(editor)).toBe('paragraph("aqr", linebreak, "b")');
            expect(undoSteps(editor, wait)).toBe(2);
        });
    });

    it('H4: an undo goes back to the loaded document after an edit made at once', () => {
        withClock((wait) => {
            const editor = load('p0');

            select(editor, 'p0', 0);
            keys(editor, wait, 10, ' ', 'x');
            wait(1000);
            command(editor, UNDO_COMMAND);

            expect(shown(editor)).toBe('paragraph("p0")');
            expect(editor.getValue()).toBe('p0');
        });
    });

    it('H5: typing after an undo and a redo does not merge into the steps before', () => {
        const script: TypingScript = (e, first, wait) => {
            typeKey(e, first); wait(1000); command(e, UNDO_COMMAND); wait(1000); command(e, REDO_COMMAND); wait(50); keys(e, wait, 10, 'x', 'y');
        };

        expect(stepsOf(script, ' ')).toBe(stepsOf(script, 'w'));
    });

    it('W8: one undo after the space and the letter, each committed on its own, gives the document back', () => {
        withClock((wait) => {
            const editor = load('p0');

            select(editor, 'p0', 0);
            keys(editor, wait, 10, ' ', 'x');

            expect(shown(editor)).toBe('paragraph("xp0")');

            command(editor, UNDO_COMMAND);

            expect(shown(editor)).toBe('paragraph("p0")');
            expect(editor.getValue()).toBe('p0');
        });
    });

    it('W13: a space and three letters typed one by one are one undo step', () => {
        withClock((wait) => {
            const editor = load('p0');

            select(editor, 'p0', 0);
            keys(editor, wait, 10, ' ', 'x', 'y', 'z');

            expect(shown(editor)).toBe('paragraph("xyzp0")');

            command(editor, UNDO_COMMAND);

            expect(shown(editor)).toBe('paragraph("p0")');
        });
    });

    it('W14: a paste that drops a tab is an undo step of its own', () => {
        withClock((wait) => {
            const editor = load('p0');

            select(editor, 'p0', -1);
            typeKey(editor, 'y');
            wait(10);
            select(editor, 'p0y', 0);
            pasteText(editor, '\tx');

            expect(shown(editor)).toBe('paragraph("xp0y")');

            command(editor, UNDO_COMMAND);

            expect(shown(editor)).toBe('paragraph("p0y")');
        });
    });

    it.each([
        ['underlined text after a hard break', 'a\\\n++ b++', 'az\\\n++ b++'],
        ['underlined text after a soft break', 'a\n++ b++', 'az\n++ b++'],
        ['a styled span after a hard break', 'a\\\n[ b]{color=red}', 'az\\\n[ b]{color=red}'],
        ['a styled span after a soft break', 'a\n[ b]{color=red}', 'az\n[ b]{color=red}'],
    ])('W15: whitespace the save writes after syntax stays: %s', (_name, source, expectedSave) => {
        const editor = load(source);
        const saved = editor.getValue();

        select(editor, 'a', 1);
        type(editor, 'z');

        expect(editor.getValue()).toBe(expectedSave);
        expect(saved).toBe(source);
        expect(shown(load(expectedSave))).toBe(shown(editor));
    });

    it.each([
        ['after a hard break', 'a\\\n'],
        ['after a soft break', 'a\n'],
        ['after two trailing spaces', 'a  \n'],
        ['on the second line of an item', '- a\n  '],
        ['on the second line of a quote', '> a\n> '],
        ['after a task marker', '- [ ] '],
    ])('W17: a span whose attributes the editor does not model keeps its whitespace, %s', (_name, before) => {
        const spans = ['[ b]{foo=1} q', '[ b]{background=yellow} q'];

        for (const span of spans) {
            const source = `${before}${span}`;
            const editor = load(source);

            expect(editor.getValue()).toBe(source);

            select(editor, ' q', -1);
            type(editor, 'z');

            expect(editor.getValue()).toBe(`${before}${span}z`);
        }
    });

    it('W17: the same on the second line of a setext heading', () => {
        const editor = load('a\n[ b]{foo=1} q\n===');

        select(editor, ' q', -1);
        type(editor, 'z');

        expect(editor.getValue()).toBe('a\n[ b]{foo=1} qz\n===');
    });

    it('W16: a code block with indented lines set to a heading written on one line keeps the whitespace it joins', () => {
        const editor = load('```\na\n  b  c\n```');

        lexicalOf(editor).update(() => { $getRoot().getAllTextNodes()[0]!.select(1, 1); }, { discrete: true });
        editor.setBlockType('h3');
        type(editor, 'x');

        expect(editor.getValue()).toBe('### ax   b  c');
        expect(shown(load(editor.getValue()))).toBe(shown(editor));
    });

    it('W9: while a text is being composed, its block keeps its whitespace; the end of the composition takes it away', () => {
        const editor = load('p0');

        select(editor, 'p0', 0);
        type(editor, ' ');
        lexicalOf(editor).update(() => {
            const text = $getRoot().getAllTextNodes()[0]!;

            // A dead key or an input method starts a composition in the text, after the space.
            $setCompositionKey(text.getKey());
            text.spliceText(1, 0, '´', true);
        }, { discrete: true });

        expect(shown(editor)).toBe('paragraph(" ´p0")');

        lexicalOf(editor).update(() => {
            const text = $getRoot().getAllTextNodes()[0]!;

            $setCompositionKey(null);
            text.spliceText(1, 1, 'é', true);
        }, { discrete: true });

        expectShownAndReloaded(editor, 'paragraph("ép0")', 'ép0');
    });

    it('W10: a paste at a paragraph\'s start is taken as typing: a space alone stays, text after it takes it away', () => {
        const editor = load('p0');

        select(editor, 'p0', 0);
        pasteText(editor, ' ');

        expect(shown(editor)).toBe('paragraph(" p0")');

        pasteText(editor, 'x');

        expectShownAndReloaded(editor, 'paragraph("xp0")', 'xp0');
    });
});
