// @vitest-environment jsdom
//
// A source-mode command is one `CodeEditor.replaceRange` call, and what the user can undo is decided by
// CodeMirror's history, which only runs in a mounted `EditorView`; the modelled test DOM never creates one.
// This file keeps the `@vitest-environment jsdom` pragma so `CodeEditor` mounts a real view, and must not call
// installTestDOM.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Transaction } from '@codemirror/state';
import { undo, redo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { CodeEditor } from '~/component/editor/CodeEditor';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import '~/component/editor/index';
import { DOM } from '~/core/DOM';

/** The editors a test built, disposed after it. */
const editors: (CodeEditor | MarkdownEditor)[] = [];

beforeEach(() => {
    // jsdom has no layout; CodeMirror's measure pass calls both.
    Range.prototype.getClientRects = (): DOMRectList => ([] as unknown as DOMRectList);
    Range.prototype.getBoundingClientRect = (): DOMRect => new DOMRect();
});
afterEach(() => {
    editors.splice(0).forEach((editor) => editor.dispose());
    vi.restoreAllMocks();
    DOM.reset();
    document.body.replaceChildren();
});

/**
 * Mounts an editor's view into the document.
 *
 * @param editor - The editor to mount.
 * @returns The live view.
 */
function mountView(editor: CodeEditor): EditorView {
    editor.getElement(true);
    (editor as any).mount();

    const view = (editor as any)._view as EditorView;

    document.body.appendChild(view.dom.parentNode ?? view.dom);

    return view;
}

/**
 * Types one character the way a keystroke does: a transaction carrying the typing user event.
 *
 * @param view - The live view.
 * @param at - Where the character goes.
 * @param character - The character.
 */
function typeAt(view: EditorView, at: number, character: string): void {
    view.dispatch({
        changes:   { from: at, insert: character },
        selection: { anchor: at + character.length },
        annotations: Transaction.userEvent.of('input.type'),
    });
}

describe('CodeEditor.replaceRange and undo', () => {
    it('1.1: a replacement made right after typing is an undo step of its own', () => {
        const editor = new CodeEditor('hello world');

        editors.push(editor);

        const view = mountView(editor);

        typeAt(view, 5, 'x');
        editor.replaceRange(0, 6, '**hellox**', { from: 2, to: 8 });

        expect(view.state.doc.toString()).toBe('**hellox** world');

        undo(view);
        expect(view.state.doc.toString()).toBe('hellox world');

        undo(view);
        expect(view.state.doc.toString()).toBe('hello world');

        redo(view);
        redo(view);
        expect(view.state.doc.toString()).toBe('**hellox** world');
    });

    it('1.4: two replacements in a row are two undo steps', () => {
        const editor = new CodeEditor('one two');

        editors.push(editor);

        const view = mountView(editor);

        editor.replaceRange(0, 3, 'ONE');
        editor.replaceRange(4, 7, 'TWO');
        expect(view.state.doc.toString()).toBe('ONE TWO');

        undo(view);
        expect(view.state.doc.toString()).toBe('ONE two');

        undo(view);
        expect(view.state.doc.toString()).toBe('one two');
    });
});
