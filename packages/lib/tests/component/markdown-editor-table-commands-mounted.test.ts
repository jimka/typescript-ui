// @vitest-environment jsdom
//
// Who holds the keyboard when a toolbar or menu command runs, and the "ran while a read-only context was on the
// stack" warning Lexical raises when its own commit moves the keyboard into the editor. jsdom is not Chromium: it
// focuses no bare `contenteditable` and moves no focus when a selection is set, so `mountedForFocus` stubs both, the
// way Chromium does them. These rows pin the calls the editor makes, not the browser's behaviour; the manual rows of
// the plan (X1-X6) are what prove the result. This file keeps the `@vitest-environment jsdom` pragma, gives the
// editor a real root element and registers `@lexical/table`'s selection observer itself, as the editor's WYSIWYG
// mount does, and must not call installTestDOM.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { $getRoot, $getSelection, $isRangeSelection, $isTextNode, $setSelection, UNDO_COMMAND } from 'lexical';
import type { LexicalEditor, TextNode } from 'lexical';
import { $createTableSelectionFrom, $isTableSelection, registerTableSelectionObserver } from '@lexical/table';
import type { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { DOM } from '~/core/DOM';

/** What a test registered on a Lexical editor, unregistered after it. */
const unregister: (() => void)[] = [];

/** What the stubs of the jsdom prototypes held before, put back after each test. */
const restore: (() => void)[] = [];

afterEach(() => {
    unregister.splice(0).forEach((remove) => remove());
    restore.splice(0).forEach((put) => put());
    DOM.reset();
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

/** A document with prose, a link and a table, so the table observer is registered while a paragraph holds the caret. */
const DOCUMENT = 'para one\n\n[link](https://x.test) text\n\n| a | b |\n| - | - |\n| c | d |\n\nafter';

/** The zero rectangle Lexical's scroll-into-view reads once the root has focus. */
const ZERO_RECT = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;

/** What a mounted editor hands the rows. */
interface Mounted {
    editor: MarkdownEditor;
    root: HTMLElement;
    button: HTMLButtonElement;
    /** `'focus'` for each time the surface's element was focused, `'commit'` for each Lexical commit, in order. */
    events: string[];
    /** The `console.warn` calls whose first argument names the read-only context. */
    warnings: unknown[][];
}

/** Reaches the private Lexical editor. */
function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

/**
 * Puts `value` on `owner[name]` for the test, and puts back what was there after it.
 *
 * @param owner - The object, a jsdom prototype.
 * @param name - The property.
 * @param value - The stub.
 */
function stub(owner: object, name: string, value: unknown): void {
    const had = Object.getOwnPropertyDescriptor(owner, name);

    Object.defineProperty(owner, name, { value, configurable: true, writable: true });
    restore.push(() => {
        if (had === undefined) {
            Reflect.deleteProperty(owner, name);
        } else {
            Object.defineProperty(owner, name, had);
        }
    });
}

/**
 * Loads `source` into a fresh editor with a real root element under the body, `@lexical/table`'s selection
 * observer registered, and the pieces of Chromium that jsdom lacks standing in for it: a root with a tab index,
 * a button to take the keyboard, zero rectangles for a range and a text node, the surface's focus as Chromium does
 * it, and a browser selection that moves the keyboard into the editor when it is set inside it.
 *
 * @param source - The Markdown to load.
 * @returns The editor and what the rows read.
 */
function mountedForFocus(source: string): Mounted {
    const editor = new MarkdownEditor();
    const root = document.createElement('div');
    const button = document.createElement('button');
    const events: string[] = [];
    const warnings: unknown[][] = [];
    const surface = (editor as unknown as { _wysiwyg: { focus(preventScroll?: boolean): unknown } })._wysiwyg;

    editor.setValue(source);
    root.contentEditable = 'true';
    root.tabIndex = 0;
    document.body.append(root, button);
    lexicalOf(editor).setRootElement(root);
    unregister.push(registerTableSelectionObserver(lexicalOf(editor), true));

    stub(Range.prototype, 'getBoundingClientRect', () => ZERO_RECT);
    stub(Text.prototype, 'getBoundingClientRect', () => ZERO_RECT);

    // The harness has no surface element, so the Lexical root stands in for it.
    vi.spyOn(editor as unknown as { surfaceHoldsKeyboard(): boolean }, 'surfaceHoldsKeyboard')
        .mockImplementation(() => root.contains(document.activeElement));
    vi.spyOn(surface, 'focus').mockImplementation(() => {
        events.push('focus');

        const selection = window.getSelection() as Selection;
        const lies = selection.anchorNode !== null && root.contains(selection.anchorNode);

        // What Chromium does on focusing a contenteditable that does not hold the selection.
        if (!lies) {
            selection.collapse(root, 0);
        }

        root.focus();

        return surface;
    });

    const original = Selection.prototype.setBaseAndExtent;

    vi.spyOn(Selection.prototype, 'setBaseAndExtent').mockImplementation(function (this: Selection, ...args: Parameters<Selection['setBaseAndExtent']>): void {
        original.apply(this, args);

        // A browser moves the keyboard to the editor when a selection is set inside it.
        const inside = root.contains(args[0]);
        const keyboardInside = root.contains(document.activeElement);

        if (inside && !keyboardInside) {
            root.focus();
        }
    });

    const warn = console.warn.bind(console);

    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        const text = typeof args[0] === 'string' ? args[0] : '';
        const namesReadOnlyContext = text.includes('read-only context');

        if (namesReadOnlyContext) {
            warnings.push(args);

            return;
        }

        warn(...args);
    });
    lexicalOf(editor).registerUpdateListener(() => { events.push('commit'); });

    return { editor, root, button, events, warnings };
}

/** The first text node showing exactly `text`. Call inside a Lexical read or update. */
function $textNodeShowing(text: string): TextNode {
    const node = $getRoot().getAllTextNodes().find((candidate) => candidate.getTextContent() === text);

    if (node === undefined) {
        throw new Error(`text node "${text}" not found`);
    }

    return node;
}

/**
 * Focuses the root, then puts the editor's caret at `offset` in the text showing `text`, which Lexical writes to
 * the browser. A row's setup step then moves the keyboard away.
 *
 * @param mounted - The mounted editor.
 * @param text - The text.
 * @param offset - The offset in it.
 */
function caretIn(mounted: Mounted, text: string, offset: number): void {
    mounted.root.focus();
    lexicalOf(mounted.editor).update(() => { $textNodeShowing(text).select(offset, offset); }, { discrete: true });
}

/**
 * Focuses the root, then selects the two cells of the table's last row, as a drag across them does.
 *
 * @param mounted - The mounted editor.
 */
function selectLastRowCells(mounted: Mounted): void {
    mounted.root.focus();
    lexicalOf(mounted.editor).update(() => {
        const table = $getRoot().getChildren().find((node) => node.getType() === 'table') as TableNode;
        const [first, second] = (table.getLastChild() as TableRowNode).getChildren() as TableCellNode[];

        $setSelection($createTableSelectionFrom(table, first, second));
    }, { discrete: true });
}

/**
 * Takes the keyboard to the button, as a click does, and forgets what happened so far. A click on a button leaves
 * the browser's selection where it was, which jsdom drops with the focus: it is put back.
 *
 * @param mounted - The mounted editor.
 */
function clickAway(mounted: Mounted): void {
    const selection = window.getSelection() as Selection;
    const held = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;

    mounted.button.focus();

    if (held !== null) {
        selection.removeAllRanges();
        selection.addRange(held);
    }

    mounted.events.length = 0;
    mounted.warnings.length = 0;
}

/** Whether the editor's selection is a table selection. */
function holdsTableSelection(editor: MarkdownEditor): boolean {
    return lexicalOf(editor).read(() => $isTableSelection($getSelection()));
}

/** The cells' texts that are bold. */
function boldTexts(editor: MarkdownEditor, texts: string[]): boolean[] {
    return lexicalOf(editor).read(() => texts.map((text) => {
        const node = $textNodeShowing(text);

        return $isTextNode(node) && node.hasFormat('bold');
    }));
}

describe('a command takes the keyboard before its update (F rows)', () => {
    it('F1: toggleBold() with cells selected gives the keyboard back to the root and keeps the cells selected', async () => {
        const mounted = mountedForFocus(DOCUMENT);

        selectLastRowCells(mounted);
        clickAway(mounted);
        mounted.editor.toggleBold();
        await Promise.resolve();

        expect(document.activeElement).toBe(mounted.root);
        expect(holdsTableSelection(mounted.editor)).toBe(true);
        expect(boldTexts(mounted.editor, ['c', 'd'])).toEqual([true, true]);
    });

    it('F2: undo after F1 takes the bold off in one step and keeps the cells selected', async () => {
        const mounted = mountedForFocus(DOCUMENT);

        selectLastRowCells(mounted);
        clickAway(mounted);
        mounted.editor.toggleBold();
        await Promise.resolve();
        lexicalOf(mounted.editor).dispatchCommand(UNDO_COMMAND, undefined);
        await Promise.resolve();

        expect(boldTexts(mounted.editor, ['c', 'd'])).toEqual([false, false]);
        expect(holdsTableSelection(mounted.editor)).toBe(true);
    });

    it('F3: toggleUnderline() with cells selected does the same', async () => {
        const mounted = mountedForFocus(DOCUMENT);

        selectLastRowCells(mounted);
        clickAway(mounted);
        mounted.editor.toggleUnderline();
        await Promise.resolve();

        const underlined = lexicalOf(mounted.editor).read(() => ['c', 'd'].map((text) => $textNodeShowing(text).hasFormat('underline')));

        expect(document.activeElement).toBe(mounted.root);
        expect(holdsTableSelection(mounted.editor)).toBe(true);
        expect(underlined).toEqual([true, true]);
    });

    it('F4: mergeTableCells() gives the keyboard back and leaves a range in the merged cell', async () => {
        const mounted = mountedForFocus(DOCUMENT);

        selectLastRowCells(mounted);
        clickAway(mounted);
        mounted.editor.mergeTableCells();
        await Promise.resolve();

        const inMergedCell = lexicalOf(mounted.editor).read(() => {
            const selection = $getSelection();

            return $isRangeSelection(selection) && selection.anchor.getNode().getTextContent() === 'd';
        });

        expect(document.activeElement).toBe(mounted.root);
        expect(inMergedCell).toBe(true);
    });

    it('F5: the surface is focused before any update commits', () => {
        const mounted = mountedForFocus(DOCUMENT);

        caretIn(mounted, 'para one', 2);
        clickAway(mounted);
        mounted.editor.setBlockAlignment('center');

        expect(mounted.events[0]).toBe('focus');
    });

    it('F6: setValue() while the keyboard is elsewhere leaves it there', async () => {
        const mounted = mountedForFocus(DOCUMENT);

        caretIn(mounted, 'para one', 2);
        clickAway(mounted);
        mounted.editor.setValue('new doc');
        await Promise.resolve();

        expect(document.activeElement).toBe(mounted.button);
    });

    it('F7: setValue() while the surface holds the keyboard keeps it and puts the caret at the document\'s start (control)', async () => {
        const mounted = mountedForFocus(DOCUMENT);

        caretIn(mounted, 'para one', 2);
        mounted.events.length = 0;
        mounted.editor.setValue('new doc');
        await Promise.resolve();

        const caret = lexicalOf(mounted.editor).read(() => {
            const selection = $getSelection();

            return $isRangeSelection(selection) ? [selection.anchor.getNode().getTextContent(), selection.anchor.offset] : null;
        });

        expect(document.activeElement).toBe(mounted.root);
        expect(caret).toEqual(['new doc', 0]);
    });

    it('F8: a browser selection in another element keeps the element focus away, so the command acts at the editor\'s caret (control)', async () => {
        const mounted = mountedForFocus(DOCUMENT);

        caretIn(mounted, 'para one', 4);
        mounted.button.focus();
        (window.getSelection() as Selection).selectAllChildren(mounted.button);
        mounted.events.length = 0;
        mounted.editor.insertImage('/i.png', { alt: 'i' });
        await Promise.resolve();

        expect(mounted.events).not.toContain('focus');
        expect(mounted.editor.getValue().split('\n\n')[0]).toBe('para![i](/i.png) one');
    });
});

describe('the editor\'s own commands raise no "read-only context" warning (W rows)', () => {
    it('W1: setBlockAlignment() from a button, the caret in a paragraph of a document holding a table', async () => {
        const mounted = mountedForFocus(DOCUMENT);

        caretIn(mounted, 'para one', 2);
        clickAway(mounted);
        mounted.editor.setBlockAlignment('center');
        await Promise.resolve();

        expect(mounted.warnings).toEqual([]);
    });

    it('W2: setTableColumnAlignment() from a button, the caret in a cell', async () => {
        const mounted = mountedForFocus(DOCUMENT);

        caretIn(mounted, 'c', 1);
        clickAway(mounted);
        mounted.editor.setTableColumnAlignment('center');
        await Promise.resolve();

        expect(mounted.warnings).toEqual([]);
    });

    it('W3: toggleLink() with a new address, the caret in a link', async () => {
        const mounted = mountedForFocus(DOCUMENT);

        caretIn(mounted, 'link', 2);
        clickAway(mounted);
        mounted.editor.toggleLink('https://y.test');
        await Promise.resolve();

        expect(mounted.warnings).toEqual([]);
    });

    it('W4: setValue() with cells selected, from a button', async () => {
        const mounted = mountedForFocus(DOCUMENT);

        selectLastRowCells(mounted);
        clickAway(mounted);
        mounted.editor.setValue('new doc');
        await Promise.resolve();

        expect(mounted.warnings).toEqual([]);
        expect(document.activeElement).toBe(mounted.button);
    });

    it('W5: the public focus(), the keyboard on a button', async () => {
        const mounted = mountedForFocus(DOCUMENT);

        caretIn(mounted, 'para one', 2);
        clickAway(mounted);
        mounted.editor.focus();
        await Promise.resolve();

        expect(mounted.warnings).toEqual([]);
        expect(document.activeElement).toBe(mounted.root);
    });

    // The canary for what stays upstream: a Lexical update made outside this editor's commands, with the keyboard
    // elsewhere, still makes Lexical's own commit pull it in and raise the warning (the table's FOCUS_COMMAND
    // listener exposes it). When this fails after a Lexical upgrade, Lexical no longer warns there: say so here,
    // as K5 does in `markdown-editor-table-edge-mounted.test.ts`.
    it('W6: a Lexical update outside the editor\'s commands still raises it (upstream canary)', async () => {
        const mounted = mountedForFocus(DOCUMENT);

        caretIn(mounted, 'para one', 2);
        clickAway(mounted);
        lexicalOf(mounted.editor).update(() => { $textNodeShowing('para one').select(4, 4); }, { discrete: true });
        await Promise.resolve();

        expect(mounted.warnings).toHaveLength(1);
    });
});
