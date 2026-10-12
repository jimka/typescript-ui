// @vitest-environment jsdom
//
// `EditorState.readOnly` is a flag that editing code reads; nothing in
// CodeMirror enforces it. Whether a key press, a paste or a click can still
// change a read-only document is decided by handlers that only run in a
// mounted `EditorView`, which the modelled test DOM never creates. This file
// keeps the `@vitest-environment jsdom` pragma so `CodeEditor` mounts a real
// view, sends it real DOM events, and must not call installTestDOM.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { foldAll, foldedRanges, language } from '@codemirror/language';
import { startCompletion } from '@codemirror/autocomplete';
import { SearchQuery, findNext, replaceAll, replaceNext, setSearchQuery } from '@codemirror/search';
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

/** A mounted editor, its live view, and how often it signalled a refused edit. */
type Mounted = { editor: CodeEditor; view: EditorView; refusals: () => number };

/**
 * Mounts an editor's view into the document, waits for its language, and
 * counts its `"readonlyedit"` events from then on.
 *
 * @param editor - The editor to mount.
 * @returns The editor, its view and a counter of `"readonlyedit"` events.
 */
async function mountInto(editor: CodeEditor): Promise<Mounted> {
    let count = 0;

    editor.on('readonlyedit', () => { count += 1; });
    editor.getElement(true);
    (editor as any).mount();

    const view = (editor as any)._view as EditorView;

    document.body.appendChild(view.dom.parentNode ?? view.dom);

    const languageId = editor.getLanguage();

    if (languageId !== null) {
        await vi.waitFor(() => expect(view.state.facet(language)).not.toBeNull());
    }

    return { editor, view, refusals: () => count };
}

/**
 * Mounts a read-only editor into the document and waits for its language.
 *
 * @param doc - The document text.
 * @param languageId - The built-in language to load, or `null` for none.
 * @returns The editor, its view and a counter of `"readonlyedit"` events.
 */
async function mountReadOnly(doc: string, languageId: string | null): Promise<Mounted> {
    const editor = new CodeEditor(doc, { language: languageId ?? undefined, readOnly: true });

    editors.push(editor);

    return mountInto(editor);
}

/**
 * Sends a real `keydown` to the editor's content.
 *
 * @param view - The live view.
 * @param key - The key's name.
 * @param keyCode - The key's legacy code, which CodeMirror reads.
 * @param ctrlKey - Whether Ctrl is held, which is CodeMirror's `Mod` here.
 * @returns Whether a key binding handled the key.
 */
function pressKey(view: EditorView, key: string, keyCode: number, ctrlKey: boolean = false): boolean {
    const event = new KeyboardEvent('keydown', { key, keyCode, ctrlKey, bubbles: true, cancelable: true });

    view.contentDOM.dispatchEvent(event);

    return event.defaultPrevented;
}

describe('CodeEditor read-only, mounted', () => {
    it('G1: Enter on a markdown list line changes nothing and signals once', async () => {
        const { view, refusals } = await mountReadOnly('- item', 'markdown');

        view.dispatch({ selection: EditorSelection.cursor(6) });
        pressKey(view, 'Enter', 13);

        expect(view.state.doc.toString()).toBe('- item');
        expect(view.state.selection.main.head).toBe(6);
        expect(refusals()).toBe(1);
    });

    it('G2: Backspace after a markdown list marker changes nothing and signals once', async () => {
        const { view, refusals } = await mountReadOnly('- a\n- ', 'markdown');

        view.dispatch({ selection: EditorSelection.cursor(6) });
        pressKey(view, 'Backspace', 8);

        expect(view.state.doc.toString()).toBe('- a\n- ');
        expect(refusals()).toBe(1);
    });

    it('G3: pasting a URL over selected markdown text changes nothing and signals once', async () => {
        const { view, refusals } = await mountReadOnly('see this page', 'markdown');
        const paste = new Event('paste', { bubbles: true, cancelable: true });

        Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'https://example.com' } });
        view.dispatch({ selection: EditorSelection.range(4, 8) });
        view.contentDOM.dispatchEvent(paste);

        expect(view.state.doc.toString()).toBe('see this page');
        expect(refusals()).toBe(1);
    });

    it('G4: clicking a completion changes nothing and signals once', async () => {
        const { view, refusals } = await mountReadOnly('fun', 'javascript');

        view.dispatch({ selection: EditorSelection.cursor(3) });
        startCompletion(view);

        const option = await vi.waitFor(() => {
            const found = document.querySelector('.cm-tooltip-autocomplete li');

            expect(found).not.toBeNull();

            return found!;
        });

        option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

        expect(view.state.doc.toString()).toBe('fun');
        expect(refusals()).toBe(1);
    });

    it('G5: setValue still loads a document, and signals nothing', async () => {
        const { editor, view, refusals } = await mountReadOnly('old', 'markdown');

        editor.setValue('new');

        expect(view.state.doc.toString()).toBe('new');
        expect(refusals()).toBe(0);
    });

    it('G6: after setReadOnly(false), Enter continues the list again', async () => {
        const { editor, view, refusals } = await mountReadOnly('- item', 'markdown');

        editor.setReadOnly(false);
        view.dispatch({ selection: EditorSelection.cursor(6) });
        pressKey(view, 'Enter', 13);

        expect(view.state.doc.toString()).toBe('- item\n- ');
        expect(refusals()).toBe(0);
    });

    it('G7: an Enter no command takes is left to the browser', async () => {
        const { view } = await mountReadOnly('a(1)', 'javascript');

        view.dispatch({ selection: EditorSelection.cursor(4) });

        // Not prevented, so a browser goes on to fire `beforeinput`, where the
        // editor's existing hook signals the refusal. jsdom fires none.
        expect(pressKey(view, 'Enter', 13)).toBe(false);
        expect(view.state.doc.toString()).toBe('a(1)');
    });

    // A read-only editor that its host fills from code is the common case:
    // a query plan, a definition, a stored value. One row per built-in
    // language, and one with no language.
    for (const languageId of ['javascript', 'json', 'html', 'sql', 'markdown', 'css', 'python', null]) {
        it(`G8: ${languageId ?? 'no language'}: setValue loads a document into a read-only editor, fires "change", and signals nothing`, async () => {
            const { editor, view, refusals } = await mountReadOnly('old', languageId);
            const changes: string[] = [];

            editor.on('change', (payload) => { changes.push(payload.value); });
            editor.setValue('new');
            editor.setValue('newer\nstill');

            expect(view.state.doc.toString()).toBe('newer\nstill');
            expect(editor.getValue()).toBe('newer\nstill');
            expect(changes).toEqual(['new', 'newer\nstill']);
            expect(view.state.readOnly).toBe(true);
            expect(refusals()).toBe(0);
        });
    }

    it('G9: while the editor is read-only, the undo and redo keys do not take a loaded document back', async () => {
        const { editor, view } = await mountReadOnly('old', 'markdown');

        editor.setValue('new');

        pressKey(view, 'z', 90, true);
        expect(view.state.doc.toString()).toBe('new');

        pressKey(view, 'y', 89, true);
        expect(view.state.doc.toString()).toBe('new');
    });

    it('G10: a plain paste and a drop change nothing and signal once each', async () => {
        const { view, refusals } = await mountReadOnly('abc', 'javascript');
        const paste = new Event('paste', { bubbles: true, cancelable: true });
        const drop  = new Event('drop', { bubbles: true, cancelable: true });

        Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'pasted' } });
        Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'dropped', files: [] } });

        view.contentDOM.dispatchEvent(paste);
        expect(view.state.doc.toString()).toBe('abc');
        expect(refusals()).toBe(1);

        view.contentDOM.dispatchEvent(drop);
        expect(view.state.doc.toString()).toBe('abc');
        expect(refusals()).toBe(2);
    });

    it('G11: selecting, searching and folding still work, and Replace changes nothing', async () => {
        const { view } = await mountReadOnly('function f() {\n  return f;\n}', 'javascript');

        pressKey(view, 'a', 65, true);
        expect(view.state.selection.main.to - view.state.selection.main.from).toBe(view.state.doc.length);

        view.dispatch({ selection: EditorSelection.cursor(0), effects: setSearchQuery.of(new SearchQuery({ search: 'return', replace: 'x' })) });
        findNext(view);
        expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('return');

        replaceNext(view);
        replaceAll(view);
        expect(view.state.doc.toString()).toBe('function f() {\n  return f;\n}');

        foldAll(view);
        expect(foldedRanges(view.state).size).toBe(1);
    });

    it('G12: Enter on an open completion list inserts nothing', async () => {
        const { view } = await mountReadOnly('fun', 'javascript');

        view.dispatch({ selection: EditorSelection.cursor(3) });
        startCompletion(view);
        await vi.waitFor(() => expect(document.querySelector('.cm-tooltip-autocomplete li')).not.toBeNull());

        pressKey(view, 'Enter', 13);
        pressKey(view, 'Tab', 9);

        expect(view.state.doc.toString()).toBe('fun');
    });

    it('G13: paste() whose clipboard read ends after the editor became read-only inserts nothing and signals once', async () => {
        const editor = new CodeEditor('abc', { language: 'javascript' });

        editors.push(editor);

        const { view, refusals } = await mountInto(editor);

        vi.spyOn(DOM.source, 'readClipboardText').mockImplementation(async () => {
            // The host makes the editor read-only while the read is in flight.
            editor.setReadOnly(true);

            return 'pasted';
        });

        const read = await editor.paste();

        expect(read).toBe(true);
        expect(view.state.doc.toString()).toBe('abc');
        expect(refusals()).toBe(1);
    });

    it('G14: the option setters still reconfigure a read-only editor', async () => {
        const { editor, view, refusals } = await mountReadOnly('{}', 'javascript');

        editor.setTabSize(2);
        editor.setLineWrap(true);
        editor.setLanguage('json');

        await vi.waitFor(() => expect(view.state.facet(language)?.name).toBe('json'));

        expect(view.state.tabSize).toBe(2);
        expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
        expect(view.state.readOnly).toBe(true);
        expect(refusals()).toBe(0);
    });

    it('G15: setReadOnly(true) on a mounted editor refuses edits from then on, and replaceRange with them', async () => {
        const editor = new CodeEditor('- item', { language: 'markdown' });

        editors.push(editor);

        const { view, refusals } = await mountInto(editor);

        editor.replaceRange(6, 6, '!');
        expect(view.state.doc.toString()).toBe('- item!');

        editor.setReadOnly(true);
        view.dispatch({ selection: EditorSelection.cursor(7) });
        pressKey(view, 'Enter', 13);
        editor.replaceRange(0, 1, '*');
        editor.cut();

        expect(view.state.doc.toString()).toBe('- item!');
        expect(refusals()).toBe(3);
    });

    it('G16: a read-only MarkdownEditor in source mode refuses a key and a command, and still takes setValue', async () => {
        const markdownEditor = new MarkdownEditor('- item', { mode: 'source', readOnly: true });
        const source         = (markdownEditor as any)._codeEditor as CodeEditor;

        editors.push(markdownEditor);

        const { view, refusals } = await mountInto(source);

        view.dispatch({ selection: EditorSelection.cursor(6) });
        pressKey(view, 'Enter', 13);
        expect(refusals()).toBe(1);

        view.dispatch({ selection: EditorSelection.range(2, 6) });
        markdownEditor.toggleBold();

        expect(markdownEditor.getValue()).toBe('- item');
        expect(refusals()).toBe(2);

        markdownEditor.setValue('new');

        expect(view.state.doc.toString()).toBe('new');
        expect(markdownEditor.getValue()).toBe('new');
        expect(refusals()).toBe(2);
    });
});
