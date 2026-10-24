// @vitest-environment jsdom
//
// `CodeEditor.openSearch()` moves focus into the floating search card, and
// with the card already open it re-seeds through CodeMirror's own
// `openSearchPanel`, which looks its panel up on a live `EditorView`. The
// modelled test DOM has neither real focus nor a live view, so this file
// keeps the `@vitest-environment jsdom` pragma so `CodeEditor` mounts a real
// view, and must not call installTestDOM.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { searchPanelOpen } from '@codemirror/search';
import { CodeEditor } from '~/component/editor/CodeEditor';
import { DOM } from '~/core/DOM';

/** The editors a test built, disposed after it. */
const editors: CodeEditor[] = [];

/** The document every case searches. */
const DOC = 'alpha beta alpha';

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
 * Builds an editor and mounts its view into the document.
 *
 * @param doc - The document text.
 * @returns The editor and its live view.
 */
function mountEditor(doc: string): { editor: CodeEditor; view: EditorView } {
    const editor = new CodeEditor(doc);

    editors.push(editor);
    editor.getElement(true);
    (editor as any).mount();

    const view = (editor as any)._view as EditorView;

    document.body.appendChild(view.dom.parentNode ?? view.dom);

    return { editor, view };
}

/**
 * Moves focus to a button outside every editor, the way a click on an app's
 * menu item or toolbar button would.
 *
 * @returns The focused button.
 */
function focusOutside(): HTMLButtonElement {
    const button = document.createElement('button');

    document.body.appendChild(button);
    button.focus();

    return button;
}

/**
 * Sends a real `Ctrl-F` keydown to the editor's content.
 *
 * @param view - The live view.
 * @returns Whether a key binding handled the key, or stopped its default.
 */
function pressCtrlF(view: EditorView): boolean {
    const event = new KeyboardEvent('keydown', { key: 'f', keyCode: 70, ctrlKey: true, bubbles: true, cancelable: true });

    view.contentDOM.dispatchEvent(event);

    return event.defaultPrevented;
}

/**
 * Tells whether keyboard focus is in the editor's find field.
 *
 * @param editor - The editor.
 * @returns `true` when the find field's input is the active element.
 */
function findFieldFocused(editor: CodeEditor): boolean {
    return DOM.source.intern(document.activeElement as Node) === (editor as any)._searchPanel._findField.getElement();
}

/**
 * Reads the values the search card's controls hold.
 *
 * @param editor - The editor.
 * @returns The card's fields.
 */
function cardFields(editor: CodeEditor): { search: string; replace: string; caseSensitive: boolean; wholeWord: boolean; regexp: boolean } {
    return (editor as any)._searchPanel.getFields();
}

/**
 * Tells whether the search card is shown.
 *
 * @param editor - The editor.
 * @returns `true` when the card is displayed.
 */
function cardShown(editor: CodeEditor): boolean {
    return (editor as any)._searchPanel.isDisplayed();
}

/**
 * Selects `beta` (6–10), moves focus outside the editor and opens the card
 * through the public method — the steps M1 checks and M3–M5 build on.
 *
 * @returns The editor, its view, and what `openSearch()` returned.
 */
function openOnBeta(): { editor: CodeEditor; view: EditorView; opened: boolean } {
    const { editor, view } = mountEditor(DOC);

    view.dispatch({ selection: EditorSelection.range(6, 10) });
    focusOutside();

    return { editor, view, opened: editor.openSearch() };
}

describe('CodeEditor.openSearch() on a mounted view', () => {
    it('M1: opens the card from focus outside the editor, seeded and focused', () => {
        const { editor, view, opened } = openOnBeta();

        expect(opened).toBe(true);
        expect(cardShown(editor)).toBe(true);
        expect(cardFields(editor).search).toBe('beta');
        expect(searchPanelOpen(view.state)).toBe(true);
        expect(findFieldFocused(editor)).toBe(true);

        const input = document.activeElement as HTMLInputElement;

        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe(4);
    });

    it('M2: leaves the same state as Ctrl-F in the document', () => {
        const byKey  = mountEditor(DOC);
        const byCall = mountEditor(DOC);

        byKey.view.dispatch({ selection: EditorSelection.range(6, 10) });
        byCall.view.dispatch({ selection: EditorSelection.range(6, 10) });

        byKey.view.focus();
        expect(pressCtrlF(byKey.view)).toBe(true);

        const keyRecord = { shown: cardShown(byKey.editor), fields: cardFields(byKey.editor), focused: findFieldFocused(byKey.editor) };

        focusOutside();
        byCall.editor.openSearch();

        const callRecord = { shown: cardShown(byCall.editor), fields: cardFields(byCall.editor), focused: findFieldFocused(byCall.editor) };

        expect(callRecord).toEqual(keyRecord);
    });

    it('M3: re-seeds from a new selection while the card is open', () => {
        const { editor, view } = openOnBeta();

        view.dispatch({ selection: EditorSelection.range(0, 5) });

        expect(editor.openSearch()).toBe(true);
        expect(cardFields(editor).search).toBe('alpha');
        expect(findFieldFocused(editor)).toBe(true);
    });

    it('M4: keeps the query on a collapsed caret, and moves focus back to the find field', () => {
        const { editor, view } = openOnBeta();

        view.dispatch({ selection: EditorSelection.cursor(0) });
        focusOutside();
        editor.openSearch();

        expect(cardFields(editor).search).toBe('beta');
        expect(findFieldFocused(editor)).toBe(true);
    });

    it('M5: reopens the card after a close, keeping its last query', () => {
        const { editor, view } = openOnBeta();

        (editor as any).runSearchCommand('close');
        expect(cardShown(editor)).toBe(false);

        view.dispatch({ selection: EditorSelection.cursor(0) });

        expect(editor.openSearch()).toBe(true);
        expect(cardShown(editor)).toBe(true);
        expect(cardFields(editor).search).toBe('beta');
    });

    it('M6: calling it twice leaves the same state as calling it once', () => {
        const { editor, view } = mountEditor(DOC);

        view.dispatch({ selection: EditorSelection.range(6, 10) });
        focusOutside();

        expect(editor.openSearch()).toBe(true);
        expect(editor.openSearch()).toBe(true);
        expect(cardShown(editor)).toBe(true);
        expect(cardFields(editor).search).toBe('beta');
        expect(findFieldFocused(editor)).toBe(true);
    });

    it('M7: returns false and does not throw once the editor is disposed', () => {
        const { editor } = mountEditor(DOC);

        // Left in `editors`: the afterEach's second dispose() is a no-op.
        editor.dispose();

        expect(editor.openSearch()).toBe(false);
    });
});
