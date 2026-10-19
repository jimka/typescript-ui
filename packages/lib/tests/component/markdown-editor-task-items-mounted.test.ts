// @vitest-environment jsdom
//
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Clicking a task item's checkbox in a mounted MarkdownEditor
// (plans/markdown-task-lists.md): a click on the box toggles it as one undo
// step, a click elsewhere toggles nothing, and a read-only editor refuses the
// click and says so. The click is a real DOM event on the real checkbox
// element, which the modelled test DOM cannot send. This file keeps the
// `@vitest-environment jsdom` pragma, mounts the editor's own surface into the
// document as the editor's WYSIWYG mount does, and must not call
// installTestDOM. `Event` here is the DOM's class, so the file must not import
// `~/core/Event`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { $createRangeSelection, $getRoot, $getSelection, $isRangeSelection, $setSelection, PASTE_COMMAND, DELETE_CHARACTER_COMMAND, KEY_ENTER_COMMAND, UNDO_COMMAND } from 'lexical';
import type { LexicalEditor } from 'lexical';
import { $getClipboardDataFromSelection } from '@lexical/clipboard';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { Component } from '~/core/Component';
import { DOM, ProductionDOMSink, ProductionDOMSource } from '~/core/DOM';

/** The editors a test built, disposed after it. */
const built: MarkdownEditor[] = [];

beforeEach(() => {
    // jsdom has no layout. With the surface focused, Lexical measures the caret it has written to scroll it into view.
    Range.prototype.getBoundingClientRect = (): DOMRect => new DOMRect();
});

afterEach(() => {
    built.splice(0).forEach((editor) => editor.dispose());   // before DOM.reset(), or a queued layout throws
    DOM.reset();
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

/** The private members the harness reaches. */
type Internals = { _editor: LexicalEditor; _wysiwyg: Component; mountWysiwyg(): void };

/** A mounted editor, its Lexical editor and the surface element Lexical renders into. */
type Mounted = { editor: MarkdownEditor; lexical: LexicalEditor; root: HTMLElement };

/**
 * Builds an editor and mounts its own WYSIWYG surface into the document as
 * Lexical's root, as the surface's first layout does in a browser.
 *
 * @param source - The Markdown to load.
 * @param readOnly - Whether the editor is constructed read-only.
 * @returns The editor, its Lexical editor and the root element.
 */
function mounted(source: string, readOnly: boolean = false): Mounted {
    const editor = new MarkdownEditor(source, { readOnly });
    const internals = editor as unknown as Internals;

    built.push(editor);
    (DOM.sink as ProductionDOMSink).appendChild((DOM.source as ProductionDOMSource).getBody(), editor.getElement(true)!);
    internals._wysiwyg.getElement(true);
    internals.mountWysiwyg();

    const root = internals._editor.getRootElement() as HTMLElement;

    root.focus();

    return { editor, lexical: internals._editor, root };
}

/**
 * The checkbox elements of a mounted surface.
 *
 * @param root - The surface element.
 * @returns The elements, in document order.
 */
function boxesOf(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>('[role="checkbox"]')];
}

/**
 * Sends a click to an element as a browser does, and lets the update it starts commit, as the time before the browser
 * sends the next event does: two clicks in one tick would be one update, and one undo step.
 *
 * @param element - The element.
 * @param lexical - The editor the element belongs to.
 */
function click(element: Element, lexical: LexicalEditor): void {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 }));
    lexical.read(() => null);
}

const SOURCE = '- [ ] one\n- [x] two\n\npara';

describe('a click on a task item\'s checkbox', () => {
    it('toggles it, fires one change and redraws it with the checked class', () => {
        const { editor, lexical, root } = mounted(SOURCE);
        let changes = 0;

        editor.on('change', () => { changes += 1; });
        click(boxesOf(root)[0]!, lexical);

        expect(editor.getValue()).toBe('- [x] one\n- [x] two\n\npara');
        expect(changes).toBe(1);
        expect(boxesOf(root)[0]!.className).toContain('ts-ui-mde-task-checkbox-checked');
        expect(boxesOf(root)[0]!.getAttribute('aria-checked')).toBe('true');
    });

    it('is one undo step each', () => {
        const { editor, lexical, root } = mounted(SOURCE);

        click(boxesOf(root)[0]!, lexical);
        click(boxesOf(root)[1]!, lexical);

        expect(editor.getValue()).toBe('- [x] one\n- [ ] two\n\npara');

        lexical.dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe('- [x] one\n- [x] two\n\npara');

        lexical.dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(SOURCE);
    });

    it('toggles nothing when the click is elsewhere', () => {
        const { editor, lexical, root } = mounted(SOURCE);
        const text = [...root.querySelectorAll('li [data-lexical-text="true"]')].find((node) => node.textContent === 'one')!;

        click(text, lexical);

        expect(editor.getValue()).toBe(SOURCE);
    });
});

describe('a caret before a task item\'s checkbox', () => {
    // The character Delete removes is found through the browser's selection, which jsdom does not implement, so the
    // deletion itself is a manual check; what the editor adds is that the caret is first settled after the checkbox.
    it('is settled after the checkbox by Delete, so the key acts after it', () => {
        const { lexical } = mounted('- [ ] one\n- [x] two');

        lexical.update(() => {
            const text = $getRoot().getAllTextNodes().find((node) => node.getTextContent() === 'two')!.getParent()!;
            const selection = $createRangeSelection();

            selection.anchor.set(text.getKey(), 0, 'element');
            selection.focus.set(text.getKey(), 0, 'element');
            $setSelection(selection);
        }, { discrete: true });
        lexical.dispatchCommand(DELETE_CHARACTER_COMMAND, false);

        const caret = lexical.read(() => {
            const selection = $getSelection();

            return $isRangeSelection(selection) ? [selection.anchor.getNode().getType(), selection.anchor.offset, selection.anchor.type] : null;
        });

        expect(caret).toEqual(['markdown-list-item-text', 1, 'element']);
    });
});

describe('a read-only editor', () => {
    it('refuses a click on a checkbox, changes nothing, says so once and plays the wash once', () => {
        const { editor, lexical, root } = mounted('- [ ] one', true);
        const flash = (editor as unknown as { _flash: { play(): void } })._flash;
        const play = vi.spyOn(flash, 'play');
        let refusals = 0;

        editor.on('readonlyedit', () => { refusals += 1; });
        click(boxesOf(root)[0]!, lexical);

        expect(editor.getValue()).toBe('- [ ] one');
        expect(refusals).toBe(1);
        expect(play).toHaveBeenCalledTimes(1);
    });

    it('draws the checkbox read-only, and editable again once the lock is lifted', () => {
        const { editor, root } = mounted('- [ ] one\n- [x] two', true);

        expect(boxesOf(root).map((box) => box.getAttribute('aria-readonly'))).toEqual(['true', 'true']);
        expect(boxesOf(root).every((box) => box.className.includes('ts-ui-mde-task-checkbox-read-only'))).toBe(true);

        editor.setReadOnly(false);

        expect(boxesOf(root).map((box) => box.getAttribute('aria-readonly'))).toEqual([null, null]);
        expect(boxesOf(root).some((box) => box.className.includes('read-only'))).toBe(false);

        editor.setReadOnly(true);

        expect(boxesOf(root).map((box) => box.getAttribute('aria-readonly'))).toEqual(['true', 'true']);
    });

    it.each([
        ['a document with a checkbox', '- [ ] one\n- [x] two'],
        ['a document with none', '- one\n- two'],
    ])('switching read-only on and off leaves the keyboard and the page selection with the button that holds them: %s', (_name, source) => {
        const { editor, lexical, root } = mounted(source);

        lexical.update(() => {
            const text = $getRoot().getAllTextNodes()[0]!;

            text.select(1, 1);
        }, { discrete: true });

        const button = document.createElement('button');

        document.body.appendChild(button);
        button.focus();
        window.getSelection()?.removeAllRanges();

        editor.setReadOnly(true);
        editor.setReadOnly(false);

        const selection = window.getSelection();

        expect(document.activeElement).toBe(button);
        expect(selection?.anchorNode === null || selection?.anchorNode === undefined || !root.contains(selection.anchorNode)).toBe(true);
    });

    it('switching read-only on and off leaves the keyboard on a surface that holds it', () => {
        const { editor, root } = mounted('- [ ] one\n- [x] two');

        root.focus();
        editor.setReadOnly(true);
        editor.setReadOnly(false);

        expect(document.activeElement).toBe(root);
    });

    it('setting the read-only state it already has draws nothing again', () => {
        const { editor, lexical } = mounted('- [ ] one');
        let updates = 0;

        lexical.registerUpdateListener(() => { updates += 1; });
        editor.setReadOnly(false);

        expect(updates).toBe(0);
    });

    it('switching read-only is no undo step and no change', () => {
        const { editor } = mounted('- [ ] one');
        let changes = 0;

        editor.on('change', () => { changes += 1; });
        editor.setReadOnly(true);
        editor.setReadOnly(false);

        expect(changes).toBe(0);
    });

    it('refuses Ctrl+Enter on a task item, changes nothing and says so once', () => {
        const { editor, lexical } = mounted('- [ ] one', true);
        let refusals = 0;

        editor.on('readonlyedit', () => { refusals += 1; });
        lexical.dispatchCommand(KEY_ENTER_COMMAND, new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }));

        expect(editor.getValue()).toBe('- [ ] one');
        expect(refusals).toBe(1);
    });
});

describe('task items copied from one editor and pasted into another', () => {
    // Each editor has a namespace of its own, so another editor reads the clipboard's HTML, not its node format.
    it.each([
        ['a bulleted list', '- [ ] a\n- [x] b'],
        ['an ordered list with a plain item', '1. [x] one\n2. plain'],
    ])('keep their checkboxes: %s', (_name, source) => {
        // jsdom has neither class, and Lexical's handlers tell events apart by class name.
        vi.stubGlobal('ClipboardEvent', class ClipboardEvent extends Event {});
        vi.stubGlobal('DragEvent', class DragEvent extends Event {});

        const from = mounted(source);
        const into = mounted('x');

        from.lexical.update(() => { $getRoot().select(0, $getRoot().getChildrenSize()); }, { discrete: true });

        const data = from.lexical.read(() => $getClipboardDataFromSelection($getSelection())) as Record<string, string>;

        into.lexical.update(() => { $getRoot().selectEnd(); }, { discrete: true });

        const event = new ClipboardEvent('paste');

        Object.defineProperty(event, 'clipboardData', {
            value: { types: Object.keys(data), files: [], getData: (type: string) => data[type] ?? '' },
        });
        into.lexical.update(() => { into.lexical.dispatchCommand(PASTE_COMMAND, event); }, { discrete: true });
        vi.unstubAllGlobals();

        expect(into.editor.getValue()).toBe(`x\n\n${source}`);
    });
});
