// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// MarkdownEditor's typing shortcuts are applied by typing alone
// (the plan `markdown-editor-typing-shortcuts-only-for-typing`): a removal, a
// paste, a drop or text that arrives with no input event completes none,
// however the text before the caret reads afterwards; a typed character, the
// end of a composition and a text replacement still do, on every route a
// browser hands them to Lexical by.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createRangeSelection, $createTextNode, $getNodeByKey, $getSelection, $isRangeSelection, $isTextNode, $setCompositionKey, $setSelection,
    BEFORE_INPUT_COMMAND, COMMAND_PRIORITY_HIGH, COMPOSITION_END_TAG, CONTROLLED_TEXT_INSERTION_COMMAND, DELETE_CHARACTER_COMMAND,
    DELETE_LINE_COMMAND, DELETE_WORD_COMMAND, INPUT_COMMAND, KEY_ENTER_COMMAND, PASTE_COMMAND, REDO_COMMAND, REMOVE_TEXT_COMMAND, UNDO_COMMAND,
} from 'lexical';
import type { LexicalCommand, LexicalEditor, RangeSelection, TextNode } from 'lexical';
import { $insertGeneratedNodes } from '@lexical/clipboard';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
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
});

/** Stands in a row's Markdown for the one character a row removes: it reads as itself and needs no escape. */
const REMOVED = ';';

/**
 * One kind of typing shortcut: a name; Markdown whose escaped text reads as
 * the shortcut's syntax, complete, once the {@link REMOVED} character is
 * gone and the caret stands in its place; the save of that text, still
 * text; and what the shortcut makes of it when its last character is typed.
 */
type Kind = readonly [name: string, source: string, text: string, applied: string];

const KINDS: readonly Kind[] = [
    ['italic', 'a \\*x\\*;b', 'a \\*x\\*b', 'a *x*b'],
    ['bold', 'a \\*\\*x\\*\\*;b', 'a \\*\\*x\\*\\*b', 'a **x**b'],
    ['inline code', 'a \\`x\\`;b', 'a \\`x\\`b', 'a `x`b'],
    ['strikethrough', 'a \\~\\~x\\~\\~;b', 'a \\~\\~x\\~\\~b', 'a ~~x~~b'],
    ['underline', 'a \\+\\+x\\+\\+;b', 'a \\+\\+x\\+\\+b', 'a ++x++b'],
    ['a link', 'a \\[t\\](u);b', 'a \\[t\\]\\(u)b', 'a [t](u)b'],
    ['a bullet', '\\- ;cd', '\\- cd', '- cd'],
    ['a bullet written with a star', '\\* ;cd', '\\* cd', '- cd'],
    ['a bullet written with a plus', '\\+ ;cd', '\\+ cd', '- cd'],
    ['a list number', '1\\. ;cd', '1\\. cd', '1. cd'],
    ['a heading', '\\# ;cd', '\\# cd', '# cd'],
    ['a level 3 heading', '\\### ;cd', '\\### cd', '### cd'],
    ['a quote', '\\> ;cd', '\\> cd', '> cd'],
    ['a code fence', '\\`\\`\\` ;cd', '\\`\\`\\` cd', '```\ncd\n```'],
];

/** One way of removing a selection. */
type Removal = 'Delete' | 'Backspace' | 'word delete' | 'line delete' | 'REMOVE_TEXT_COMMAND' | 'cut()';

const REMOVALS: readonly Removal[] = ['Delete', 'Backspace', 'word delete', 'line delete', 'REMOVE_TEXT_COMMAND', 'cut()'];

/** One way of inserting text that is not typing it. */
type Insertion = 'PASTE_COMMAND' | 'paste()' | 'paste nodes' | 'drop insert' | 'yank insert';

const INSERTIONS: readonly Insertion[] = ['PASTE_COMMAND', 'paste()', 'paste nodes', 'drop insert', 'yank insert'];

/** Whether a range is dragged from its end to its start, and whether a command is dispatched inside one update. */
const VARIANTS: ReadonlyArray<readonly [backward: boolean, inUpdate: boolean]> = [[false, true], [false, false], [true, true], [true, false]];

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
 * Loads a kind's Markdown and selects, in the text node that holds the
 * {@link REMOVED} character, that character with the `before` characters
 * ahead of it.
 *
 * @param source - The Markdown.
 * @param before - How many characters ahead of the removed one the range takes in.
 * @param backward - Whether the range is dragged from its end to its start.
 * @returns The editor.
 */
function select(source: string, before: number, backward: boolean): MarkdownEditor {
    const editor = load(source);

    lexicalOf(editor).update(() => {
        const node = $dfs().map((entry) => entry.node).find((found) => $isTextNode(found) && found.getTextContent().includes(REMOVED)) as TextNode;
        const at = node.getTextContent().indexOf(REMOVED);
        const selection = $createRangeSelection();
        const [anchor, focus] = backward ? [at + 1, at - before] : [at - before, at + 1];

        selection.anchor.set(node.getKey(), anchor, 'text');
        selection.focus.set(node.getKey(), focus, 'text');
        $setSelection(selection);
    }, { discrete: true });

    return editor;
}

/**
 * Dispatches a command, inside one update as a browser's key and input events do, or outside any.
 *
 * @param editor - The editor.
 * @param command - The command.
 * @param payload - Its payload.
 * @param inUpdate - Whether to dispatch inside an update.
 */
function dispatch<P>(editor: MarkdownEditor, command: LexicalCommand<P>, payload: P, inUpdate: boolean): void {
    const lexical = lexicalOf(editor);

    if (inUpdate) {
        lexical.update(() => { lexical.dispatchCommand(command, payload); }, { discrete: true });
    } else {
        lexical.dispatchCommand(command, payload);
    }
}

/**
 * Removes the editor's selection one way.
 *
 * @param editor - The editor.
 * @param removal - The way.
 * @param inUpdate - Whether a command is dispatched inside an update.
 */
function remove(editor: MarkdownEditor, removal: Removal, inUpdate: boolean): void {
    switch (removal) {
        case 'Delete': dispatch(editor, DELETE_CHARACTER_COMMAND, false, inUpdate); break;
        case 'Backspace': dispatch(editor, DELETE_CHARACTER_COMMAND, true, inUpdate); break;
        case 'word delete': dispatch(editor, DELETE_WORD_COMMAND, false, inUpdate); break;
        case 'line delete': dispatch(editor, DELETE_LINE_COMMAND, true, inUpdate); break;
        case 'REMOVE_TEXT_COMMAND': dispatch(editor, REMOVE_TEXT_COMMAND, null, inUpdate); break;
        case 'cut()': editor.cut(); break;
    }
}

/**
 * A data transfer holding `text` as plain text.
 *
 * @param text - The text.
 * @returns The transfer's `types`, `files` and `getData`.
 */
function transferOf(text: string): { types: string[]; files: never[]; getData: (type: string) => string } {
    return { types: ['text/plain'], files: [], getData: (type: string) => (type === 'text/plain' ? text : '') };
}

/**
 * Stands in for a browser's input event. `InputEvent` is stubbed with an empty class here, so its fields are assigned.
 *
 * @param inputType - The event's `inputType`.
 * @param fields - The fields that differ from an event that carries nothing and was not prevented.
 * @returns The event.
 */
function inputEvent(inputType: string, fields: Record<string, unknown> = {}): InputEvent {
    return Object.assign(new InputEvent('beforeinput'), { inputType, data: null, dataTransfer: null, defaultPrevented: false, ...fields }) as InputEvent;
}

/**
 * Takes `BEFORE_INPUT_COMMAND` and `INPUT_COMMAND` ahead of Lexical's own handlers, which read a browser's DOM
 * selection and cannot run here, and behind the editor's listeners, which are the ones under test. `onInput` stands in
 * for what Lexical's `input` handler does: it reads the text the browser changed off the DOM.
 *
 * @param lexical - The Lexical editor.
 * @param onInput - What the `input` handler does to the document.
 * @returns The unregister function.
 */
function standInForLexicalInputHandlers(lexical: LexicalEditor, onInput: () => void = () => {}): () => void {
    const unregisterBeforeInput = lexical.registerCommand(BEFORE_INPUT_COMMAND, () => true, COMMAND_PRIORITY_HIGH);
    const unregisterInput = lexical.registerCommand(INPUT_COMMAND, () => {
        onInput();

        return true;
    }, COMMAND_PRIORITY_HIGH);

    return () => {
        unregisterBeforeInput();
        unregisterInput();
    };
}

/**
 * What Lexical does with a character the browser inserted itself: reads the text node's new text off the DOM and puts
 * the caret after the character.
 *
 * @param typed - The character.
 */
function $syncInsertedCharacter(typed: string): void {
    const selection = $getSelection();

    if ($isRangeSelection(selection)) {
        const node = selection.anchor.getNode() as TextNode;
        const at = selection.anchor.offset;
        const text = node.getTextContent();

        node.setTextContent(text.slice(0, at) + typed + text.slice(at));
        node.select(at + 1, at + 1);
    }
}

/**
 * What Lexical does with a deletion the browser made itself: reads the text node's new text off the DOM and puts the
 * caret where the text went.
 */
function $syncDeletedSelection(): void {
    const selection = $getSelection();

    if ($isRangeSelection(selection)) {
        const node = selection.anchor.getNode() as TextNode;
        const at = Math.min(selection.anchor.offset, selection.focus.offset);
        const shown = node.getTextContent();

        node.setTextContent(shown.slice(0, at) + shown.slice(at + 1));
        node.select(at, at);
    }
}

/** Removes the one character before the caret, as a composition that shrinks does. */
function $removeBeforeCaret(): void {
    const selection = $getSelection();

    if ($isRangeSelection(selection)) {
        const node = selection.anchor.getNode() as TextNode;
        const at = selection.anchor.offset;
        const text = node.getTextContent();

        node.setTextContent(text.slice(0, at - 1) + text.slice(at));
        node.select(at - 1, at - 1);
    }
}

/**
 * Inserts `text` at the editor's selection one way that is not typing it.
 *
 * @param editor - The editor.
 * @param insertion - The way.
 * @param text - The text.
 * @param inUpdate - Whether a command is dispatched inside an update.
 */
async function insert(editor: MarkdownEditor, insertion: Insertion, text: string, inUpdate: boolean): Promise<void> {
    const lexical = lexicalOf(editor);

    switch (insertion) {
        case 'PASTE_COMMAND':
            dispatch(editor, PASTE_COMMAND, Object.assign(new ClipboardEvent('paste'), { clipboardData: transferOf(text), preventDefault: () => {} }), inUpdate);
            break;
        case 'paste()':
            vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue(text);
            await editor.paste();
            break;
        case 'paste nodes':
            lexical.update(() => { $insertGeneratedNodes(lexical, [$createTextNode(text)], $getSelection()!); }, { discrete: true });
            break;
        // What `insertFromDrop` and `insertFromYank` dispatch: the input event, carrying a data transfer.
        case 'drop insert':
            dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, inputEvent('insertFromDrop', { dataTransfer: transferOf(text) }), inUpdate);
            break;
        case 'yank insert':
            dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, inputEvent('insertFromYank', { dataTransfer: transferOf(text) }), inUpdate);
            break;
    }
}

/**
 * The editor's Markdown once nothing is pending: a shortcut is applied in an
 * update of its own, which the listener that sees the typed character
 * starts when that character's update is committed, so each read here
 * commits what the one before it started.
 *
 * @param editor - The editor.
 * @returns Its Markdown.
 */
function settledValue(editor: MarkdownEditor): string {
    lexicalOf(editor).read(() => null);
    lexicalOf(editor).read(() => null);

    return editor.getValue();
}

/**
 * The character that completes a kind's syntax, which stands right ahead of the {@link REMOVED} one.
 *
 * @param editor - An editor whose selection {@link select} made with one character ahead.
 * @returns The character.
 */
function completingCharacter(editor: MarkdownEditor): string {
    return lexicalOf(editor).read(() => {
        const selection = $getSelection();
        const text = $isRangeSelection(selection) ? selection.getTextContent() : '';

        return text[0]!;
    });
}

/** One route by which a browser hands a typed character to Lexical. */
type TypingRoute = readonly [name: string, type: (editor: MarkdownEditor, typed: string) => void];

/** The one typing route whose text is read in an update of its own, which is no command. */
const ROUTE_READING_TEXT_IN_ITS_OWN_UPDATE = 'a beforeinput left to the browser, the text read off the DOM in an update with no command, then the input event';

const TYPING_ROUTES: readonly TypingRoute[] = [
    ['the text-insertion command with the character, inside an update', (editor, typed) => dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, typed, true)],
    ['the text-insertion command with the character, outside any update', (editor, typed) => dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, typed, false)],
    ['a beforeinput left to the browser, then the input event that reads the text', (editor, typed) => {
        const lexical = lexicalOf(editor);
        const unregister = standInForLexicalInputHandlers(lexical, () => $syncInsertedCharacter(typed));

        dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('insertText', { data: typed }), true);
        dispatch(editor, INPUT_COMMAND, inputEvent('insertText', { data: typed }), true);
        unregister();
    }],
    [ROUTE_READING_TEXT_IN_ITS_OWN_UPDATE, (editor, typed) => {
        const lexical = lexicalOf(editor);
        const unregister = standInForLexicalInputHandlers(lexical);

        dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('insertText', { data: typed }), true);
        lexical.update(() => $syncInsertedCharacter(typed), { discrete: true });
        dispatch(editor, INPUT_COMMAND, inputEvent('insertText', { data: typed }), true);
        unregister();
    }],
    ['a composition commit as Safari hands it over, inside an update', (editor, typed) => dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, inputEvent('insertFromComposition', { data: typed }), true)],
    ['a composition commit as Safari hands it over, outside any update', (editor, typed) => dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, inputEvent('insertFromComposition', { data: typed }), false)],
    ['a text replacement carrying its text as data', (editor, typed) => dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, inputEvent('insertReplacementText', { data: typed }), true)],
    ['a text replacement carrying a data transfer', (editor, typed) => dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, inputEvent('insertReplacementText', { dataTransfer: transferOf(typed) }), true)],
];

/** One update that removes the selected character with no typing behind it, other than a removal command. */
type QuietRemoval = readonly [name: string, remove: (editor: MarkdownEditor) => void];

const QUIET_REMOVALS: readonly QuietRemoval[] = [
    ['an update with no command and no input event', (editor) => { lexicalOf(editor).update(() => $syncDeletedSelection(), { discrete: true }); }],
    ['a deleteContentBackward left to the browser, then the input event that reads the text', (editor) => {
        const lexical = lexicalOf(editor);
        const unregister = standInForLexicalInputHandlers(lexical, () => $syncDeletedSelection());

        dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('deleteContentBackward'), true);
        dispatch(editor, INPUT_COMMAND, inputEvent('deleteContentBackward'), true);
        unregister();
    }],
    ['a typing beforeinput that was prevented, then an update with no command', (editor) => {
        const lexical = lexicalOf(editor);
        const unregister = standInForLexicalInputHandlers(lexical);

        dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('insertText', { data: 'q', defaultPrevented: true }), true);
        lexical.update(() => $syncDeletedSelection(), { discrete: true });
        unregister();
    }],
    ['a typing beforeinput whose input event has arrived, then an update with no command', (editor) => {
        const lexical = lexicalOf(editor);
        const unregister = standInForLexicalInputHandlers(lexical);

        dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('insertText', { data: 'q' }), true);
        dispatch(editor, INPUT_COMMAND, inputEvent('insertText', { data: 'q' }), true);
        lexical.update(() => $syncDeletedSelection(), { discrete: true });
        unregister();
    }],
];

describe('a Markdown typing shortcut is applied by typing alone (TY rows)', () => {
    it.each(KINDS)('TY1: a removal that leaves the caret right behind %s completes no shortcut', (_name, source, text) => {
        for (const removal of REMOVALS) {
            for (const [backward, inUpdate] of VARIANTS) {
                const editor = select(source, 0, backward);
                const context = `${removal}, backward ${backward}, in an update ${inUpdate}`;

                remove(editor, removal, inUpdate);
                expect(settledValue(editor), context).toBe(text);

                // The removal is the one step there is: no shortcut ran as an update of its own after it.
                lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
                expect(settledValue(editor), `${context}, undone`).toBe(source);

                editor.dispose();
            }
        }
    });

    it.each(KINDS)('TY2: typing the character that completes %s applies the shortcut, on every route, as a step of its own', (_name, source, text, applied) => {
        for (const [route, type] of TYPING_ROUTES) {
            const editor = select(source, 1, false);
            const typed = completingCharacter(editor);

            remove(editor, 'Delete', true);

            const base = settledValue(editor);

            type(editor, typed);
            expect(settledValue(editor), route).toBe(applied);

            // One undo takes the shortcut back and leaves the typed character, a second takes the character.
            lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
            expect(settledValue(editor), `${route}, undone once`).toBe(text);
            lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
            expect(settledValue(editor), `${route}, undone twice`).toBe(base);

            // A redo puts the character back and applies nothing; a second puts the shortcut back.
            lexicalOf(editor).dispatchCommand(REDO_COMMAND, undefined);
            expect(settledValue(editor), `${route}, redone once`).toBe(text);
            lexicalOf(editor).dispatchCommand(REDO_COMMAND, undefined);
            expect(settledValue(editor), `${route}, redone twice`).toBe(applied);

            editor.dispose();
        }
    });

    it.each(KINDS)('TY3: the end of a composition, whose text went in while it was composed, completes %s', (_name, source, _text, applied) => {
        const editor = select(source, 1, false);
        const typed = completingCharacter(editor);
        const lexical = lexicalOf(editor);

        remove(editor, 'Delete', true);

        // An input method composes the character: Lexical puts it into the text node while the composition is on, when
        // the shortcuts wait, and the update that ends the composition changes no text.
        lexical.update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                $setCompositionKey(selection.anchor.key);
            }

            $syncInsertedCharacter(typed);
        }, { discrete: true });
        expect(settledValue(editor)).not.toBe(applied);

        lexical.update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                $setCompositionKey(null);
                selection.anchor.getNode().markDirty();
                // The composition moved the caret when it put the character in; its end does not move it again.
                $setSelection(selection.clone());
            }
        }, { discrete: true, tag: COMPOSITION_END_TAG });

        expect(settledValue(editor)).toBe(applied);

        editor.dispose();
    });

    it.each(KINDS)('TY4: pasting or dropping the character that completes %s completes no shortcut', async (_name, source, text) => {
        for (const insertion of INSERTIONS) {
            for (const inUpdate of [true, false]) {
                const editor = select(source, 1, false);
                const pasted = completingCharacter(editor);

                remove(editor, 'Delete', true);
                await insert(editor, insertion, pasted, inUpdate);
                expect(settledValue(editor), `${insertion}, in an update ${inUpdate}`).toBe(text);

                editor.dispose();
            }
        }
    });

    it.each(KINDS)('TY5: a removal with no removal command behind it completes no shortcut behind %s', (_name, source, text) => {
        for (const [name, removeQuietly] of QUIET_REMOVALS) {
            const editor = select(source, 0, false);

            removeQuietly(editor);
            expect(settledValue(editor), name).toBe(text);

            editor.dispose();
        }
    });

    it.each(KINDS)('TY6: the character that completes %s, put in by an update with no input event behind it, completes no shortcut', (_name, source, text) => {
        const editor = select(source, 1, false);
        const typed = completingCharacter(editor);

        remove(editor, 'Delete', true);
        lexicalOf(editor).update(() => $syncInsertedCharacter(typed), { discrete: true });

        expect(settledValue(editor)).toBe(text);

        editor.dispose();
    });

    it.each([false, true])('TY7: a character typed over a selection completes a shortcut (selected backwards: %s)', (backward) => {
        const editor = load('a \\*x zz b');

        lexicalOf(editor).update(() => {
            const node = $dfs().map((entry) => entry.node).find((found) => $isTextNode(found)) as TextNode;
            const at = node.getTextContent().indexOf(' zz');
            const selection = $createRangeSelection();
            const [anchor, focus] = backward ? [at + 3, at] : [at, at + 3];

            selection.anchor.set(node.getKey(), anchor, 'text');
            selection.focus.set(node.getKey(), focus, 'text');
            $setSelection(selection);
        }, { discrete: true });

        dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, '*', true);
        expect(settledValue(editor)).toBe('a *x* b');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        expect(settledValue(editor)).toBe('a \\*x\\* b');
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        expect(settledValue(editor)).toBe('a \\*x zz b');

        editor.dispose();
    });

    it.each([
        ['a code fence', '\\`\\`\\`;', '```\n```'],
        ['a code fence with a language', '\\`\\`\\`js;', '```js\n```'],
        ['a bullet marker and its space', 'x\\- ;', '-'],
        ['a heading marker and its space', 'x\\# ;', '#'],
    ])('TY8: Enter at the end of a block whose text is %s still converts the block', (_name, source, converted) => {
        const editor = select(source, 0, false);

        remove(editor, 'Delete', true);

        // The leading `x` keeps the marker's space from being trimmed on load; with it gone the block's text is the marker.
        lexicalOf(editor).update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                const node = selection.anchor.getNode() as TextNode;
                const shown = node.getTextContent();

                node.setTextContent(shown.startsWith('x') ? shown.slice(1) : shown);
                node.selectEnd();
            }
        }, { discrete: true });

        dispatch(editor, KEY_ENTER_COMMAND, null, true);
        expect(settledValue(editor)).toBe(converted);

        editor.dispose();
    });

    // A read-only editor refuses its input commands ahead of the marks (markdownReadOnly.ts), so a refused edit is
    // tagged as nothing. The route that reads its text in an update of its own is no command and is left out.
    it.each(KINDS)('TY9: the read-only guard takes every typing route that is a command, so none changes the text of %s', (_name, source) => {
        const commandRoutes = TYPING_ROUTES.filter(([route]) => route !== ROUTE_READING_TEXT_IN_ITS_OWN_UPDATE);

        for (const [route, type] of commandRoutes) {
            const editor = select(source, 1, false);
            const typed = completingCharacter(editor);

            remove(editor, 'Delete', true);

            const base = settledValue(editor);

            editor.setReadOnly(true);
            type(editor, typed);
            expect(settledValue(editor), route).toBe(base);

            editor.dispose();
        }
    });

    // The wait for an `input` event ends at a definite point, so it never outlives the event it is for.
    it.each(KINDS)('TY10: a wait for an input event that a read-only editor refused ends with the switch, so a removal after read-only is lifted completes no shortcut (%s)', (_name, source, text) => {
        for (const removal of ['Backspace', 'cut()'] as const) {
            const editor = select(source, 0, false);
            const lexical = lexicalOf(editor);
            const unregister = standInForLexicalInputHandlers(lexical);

            dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('insertText', { data: 'q' }), true);
            unregister();
            editor.setReadOnly(true);
            dispatch(editor, INPUT_COMMAND, inputEvent('insertText', { data: 'q' }), true);
            editor.setReadOnly(false);
            remove(editor, removal, true);

            expect(settledValue(editor), removal).toBe(text);

            editor.dispose();
        }
    });

    it.each(KINDS)('TY11: a typed beforeinput whose input event never arrives is not awaited past its task, so a removal after it completes no shortcut (%s)', async (_name, source, text) => {
        for (const removal of ['Backspace', 'cut()'] as const) {
            const editor = select(source, 0, false);
            const unregister = standInForLexicalInputHandlers(lexicalOf(editor));

            dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('insertText', { data: 'q' }), true);
            unregister();
            await new Promise((resolve) => setTimeout(resolve, 0));
            remove(editor, removal, true);

            expect(settledValue(editor), removal).toBe(text);

            editor.dispose();
        }
    });

    it.each(KINDS)('TY12: read-only switched on while an input event is awaited, an update that changes the text with no command completes no shortcut (%s)', (_name, source, text) => {
        const editor = select(source, 1, false);
        const typed = completingCharacter(editor);
        const lexical = lexicalOf(editor);

        remove(editor, 'Delete', true);

        const unregister = standInForLexicalInputHandlers(lexical);

        dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('insertText', { data: typed }), true);
        unregister();
        editor.setReadOnly(true);
        lexical.update(() => $syncInsertedCharacter(typed), { discrete: true });

        expect(settledValue(editor)).toBe(text);

        editor.dispose();
    });

    // Marks that no route above reaches by its own tag: each fails when its line of `registerTypedTextMarks` goes.
    it.each(KINDS)('TY13: text Lexical inserts in the update of a prevented typing beforeinput completes %s', (_name, source, _text, applied) => {
        const editor = select(source, 1, false);
        const typed = completingCharacter(editor);
        const lexical = lexicalOf(editor);

        remove(editor, 'Delete', true);

        // Lexical's own handler for a character it inserts itself (Safari's replacement sent as `insertText`): it
        // inserts in the `beforeinput` update and prevents the event.
        const unregister = lexical.registerCommand(BEFORE_INPUT_COMMAND, () => {
            $syncInsertedCharacter(typed);

            return true;
        }, COMMAND_PRIORITY_HIGH);

        dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('insertText', { data: typed, defaultPrevented: true }), true);
        unregister();

        expect(settledValue(editor)).toBe(applied);

        editor.dispose();
    });

    it.each(KINDS)('TY14: an insertCompositionText input event that reads its text off the DOM, with no composition on, completes %s', (_name, source, _text, applied) => {
        const editor = select(source, 1, false);
        const typed = completingCharacter(editor);

        remove(editor, 'Delete', true);

        const unregister = standInForLexicalInputHandlers(lexicalOf(editor), () => $syncInsertedCharacter(typed));

        dispatch(editor, INPUT_COMMAND, inputEvent('insertCompositionText', { data: typed }), true);
        unregister();

        expect(settledValue(editor)).toBe(applied);

        editor.dispose();
    });

    it.each(KINDS)('TY15: a deletion the browser makes, read off the DOM before its input event, completes no shortcut behind %s', (_name, source, text) => {
        const editor = select(source, 0, false);
        const lexical = lexicalOf(editor);
        const unregister = standInForLexicalInputHandlers(lexical);

        dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('deleteContentBackward'), true);
        lexical.update(() => $syncDeletedSelection(), { discrete: true });
        dispatch(editor, INPUT_COMMAND, inputEvent('deleteContentBackward'), true);
        unregister();

        expect(settledValue(editor)).toBe(text);

        editor.dispose();
    });

    // Known limit: the end of a composition counts as typing whatever the composition did, so one that is cancelled,
    // emptied or ends by removing text right behind shortcut-shaped text applies the shortcut, as it does without the
    // typing rule. These rows pin that behaviour; a change that closes the limit changes them.
    it.each(KINDS)('TY16, known limit: a composition begun right behind %s and cancelled still applies the shortcut', (_name, source, _text, applied) => {
        const editor = select(source, 0, false);
        const lexical = lexicalOf(editor);

        remove(editor, 'Delete', true);

        lexical.update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                $setCompositionKey(selection.anchor.key);
            }

            $syncInsertedCharacter('k');
        }, { discrete: true });
        lexical.update(() => $removeBeforeCaret(), { discrete: true });
        lexical.update(() => $setCompositionKey(null), { discrete: true, tag: COMPOSITION_END_TAG });

        expect(settledValue(editor)).toBe(applied);

        editor.dispose();
    });

    it.each(KINDS)('TY17, known limit: a composition that ends by removing the character behind %s still applies the shortcut', (_name, source, _text, applied) => {
        const editor = select(source, 0, false);
        const lexical = lexicalOf(editor);

        // An input method composes the word the caret stands in; its Backspace removes the `;` and the composition ends.
        lexical.update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                const node = selection.anchor.getNode() as TextNode;
                const at = Math.max(selection.anchor.offset, selection.focus.offset);

                $setCompositionKey(node.getKey());
                node.select(at, at);
            }
        }, { discrete: true });
        lexical.update(() => $removeBeforeCaret(), { discrete: true });
        lexical.update(() => $setCompositionKey(null), { discrete: true, tag: COMPOSITION_END_TAG });

        expect(settledValue(editor)).toBe(applied);

        editor.dispose();
    });

    // A character composed over a selection completes a shortcut as a typed key does (TY7): the composition's first
    // update replaces the selection with the character, so the text is not longer than before it began.
    it.each([false, true])('TY18: a character composed over a selection completes a shortcut (selected backwards: %s)', (backward) => {
        const editor = load('a \\*x zz b');
        const lexical = lexicalOf(editor);

        lexical.update(() => {
            const node = $dfs().map((entry) => entry.node).find((found) => $isTextNode(found)) as TextNode;
            const at = node.getTextContent().indexOf(' zz');
            const selection = $createRangeSelection();
            const [anchor, focus] = backward ? [at + 3, at] : [at, at + 3];

            selection.anchor.set(node.getKey(), anchor, 'text');
            selection.focus.set(node.getKey(), focus, 'text');
            $setSelection(selection);
        }, { discrete: true });
        lexical.update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                selection.insertText('*');
                $setCompositionKey(selection.anchor.key);
            }
        }, { discrete: true });
        lexical.update(() => {
            const selection = $getSelection();

            $setCompositionKey(null);

            if ($isRangeSelection(selection)) {
                $setSelection(selection.clone());
            }
        }, { discrete: true, tag: COMPOSITION_END_TAG });

        expect(settledValue(editor)).toBe('a *x* b');

        editor.dispose();
    });

    // The wait ends at the next `beforeinput` command: one that is not typing leaves nothing awaited.
    it.each(KINDS)('TY19: a typed beforeinput followed by a deletion beforeinput leaves no wait, so a removal read in an update with no command completes no shortcut (%s)', (_name, source, text) => {
        const editor = select(source, 0, false);
        const unregister = standInForLexicalInputHandlers(lexicalOf(editor));

        dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('insertText', { data: 'q' }), true);
        dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('deleteContentBackward'), true);
        lexicalOf(editor).update(() => $syncDeletedSelection(), { discrete: true });
        unregister();

        expect(settledValue(editor)).toBe(text);

        editor.dispose();
    });
});
