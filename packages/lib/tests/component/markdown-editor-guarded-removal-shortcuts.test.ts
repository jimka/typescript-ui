// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// MarkdownEditor's typing shortcuts and the removals of its guarded ranges
// (plans/markdown-editor-raw-block-range-edits.md): a range removed from
// escaped text into a raw block completes no shortcut, whatever the text
// before the joint reads as afterwards; the character that completes one,
// typed over such a range, completes it as typing it after the removal does.

vi.mock('@lexical/clipboard', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@lexical/clipboard')>()),
    copyToClipboard: vi.fn(async () => true),
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createRangeSelection, $getSelection, $isRangeSelection, $isTextNode, $setSelection,
    CONTROLLED_TEXT_INSERTION_COMMAND, DELETE_CHARACTER_COMMAND, DELETE_LINE_COMMAND, DELETE_WORD_COMMAND,
    CUT_COMMAND, INSERT_LINE_BREAK_COMMAND, INSERT_PARAGRAPH_COMMAND, KEY_ENTER_COMMAND, REMOVE_TEXT_COMMAND, UNDO_COMMAND,
} from 'lexical';
import type { LexicalCommand, LexicalEditor } from 'lexical';
import { copyToClipboard } from '@lexical/clipboard';
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
    ['a code fence', '\\`\\`\\` ;cd', '\\``` cd', '```\ncd\n```'],
];

/** One way of removing a selection. */
type Removal = 'Delete' | 'Backspace' | 'word delete' | 'line delete' | 'REMOVE_TEXT_COMMAND' | 'cut()' | 'CUT_COMMAND' | 'Enter' | 'Shift+Enter' | 'INSERT_PARAGRAPH_COMMAND';

const REMOVALS: readonly Removal[] = ['Delete', 'Backspace', 'word delete', 'line delete', 'REMOVE_TEXT_COMMAND', 'cut()', 'CUT_COMMAND'];

/** The routes that remove a range and then split the block or break the line, inserting no text. */
const SPLITS: readonly Removal[] = ['Enter', 'Shift+Enter', 'INSERT_PARAGRAPH_COMMAND'];

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

/** A raw Markdown block, which the last block of a row's document is followed by, so that a range can run into it. */
const RAW = '<div>\nraw text\n</div>';

/**
 * Loads a kind's Markdown with a raw block after it, and selects from the
 * {@link REMOVED} character to the third character of the raw block's first
 * line: a range that ends in a raw block, which the editor removes itself.
 * What is left of the kind's block is the text before the {@link REMOVED}
 * character with the raw block's rest joined after it.
 *
 * @param source - The kind's Markdown.
 * @param backward - Whether the range is dragged from its end to its start.
 * @param before - How many characters ahead of the removed one the range takes in.
 * @returns The editor.
 */
function selectIntoRaw(source: string, backward: boolean, before: number = 0): MarkdownEditor {
    const editor = load(`${source}\n\n${RAW}`);

    lexicalOf(editor).update(() => {
        const nodes = $dfs().map((entry) => entry.node).filter($isTextNode);
        const node = nodes.find((found) => found.getTextContent().includes(REMOVED))!;
        const raw = nodes.find((found) => found.getTextContent() === 'raw text')!;
        const at = node.getTextContent().indexOf(REMOVED) - before;
        const selection = $createRangeSelection();
        const [anchor, focus]: Array<[string, number]> = backward ? [[raw.getKey(), 2], [node.getKey(), at]] : [[node.getKey(), at], [raw.getKey(), 2]];

        selection.anchor.set(anchor[0], anchor[1], 'text');
        selection.focus.set(focus[0], focus[1], 'text');
        $setSelection(selection);
    }, { discrete: true });

    return editor;
}

/** What the raw block's rest reads as once it is joined after a paragraph's text. */
const JOINED_RAW_REST = 'w text\\\n\\</div>';

/**
 * What a kind's block saves as once {@link selectIntoRaw}'s range is removed: the kind's text before the
 * {@link REMOVED} character, as its removal saves it, with the raw block's rest joined after it.
 *
 * @param source - The kind's Markdown.
 * @param text - The kind's text with the {@link REMOVED} character gone.
 * @returns The Markdown.
 */
function joinedWithRaw(source: string, text: string): string {
    const after = source.slice(source.indexOf(REMOVED) + 1);

    return `${text.slice(0, text.length - after.length)}${JOINED_RAW_REST}`;
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
        case 'CUT_COMMAND': dispatch(editor, CUT_COMMAND, null, inUpdate); break;
        case 'Enter': dispatch(editor, KEY_ENTER_COMMAND, null, inUpdate); break;
        case 'Shift+Enter': dispatch(editor, INSERT_LINE_BREAK_COMMAND, false, inUpdate); break;
        case 'INSERT_PARAGRAPH_COMMAND': dispatch(editor, INSERT_PARAGRAPH_COMMAND, undefined, inUpdate); break;
    }
}

/**
 * Removes the editor's selection one way, and waits for the native cut, which removes in an update queued behind the copy.
 *
 * @param editor - The editor.
 * @param removal - The way.
 * @param inUpdate - Whether a command is dispatched inside an update.
 */
async function removeAndSettle(editor: MarkdownEditor, removal: Removal, inUpdate: boolean): Promise<void> {
    remove(editor, removal, inUpdate);

    if (removal === 'CUT_COMMAND') {
        await vi.waitFor(() => expect(copyToClipboard).toHaveBeenCalled());
        await Promise.resolve();
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
 * @param editor - An editor whose selection {@link selectIntoRaw} made with one character ahead.
 * @returns The character.
 */
function completingCharacter(editor: MarkdownEditor): string {
    return lexicalOf(editor).read(() => {
        const selection = $getSelection();
        const text = $isRangeSelection(selection) ? selection.getTextContent() : '';

        return text[0]!;
    });
}

describe('a range the editor removes itself completes no Markdown typing shortcut (TY rows)', () => {
    it.each(KINDS)('TY1: the removal of a range that ends in a raw block, which leaves the caret right behind %s, completes no shortcut', async (_name, source, text) => {
        const joined = joinedWithRaw(source, text);

        for (const removal of REMOVALS) {
            for (const [backward, inUpdate] of VARIANTS) {
                const context = `${removal}, backward ${backward}, in an update ${inUpdate}`;
                const editor = selectIntoRaw(source, backward);

                await removeAndSettle(editor, removal, inUpdate);
                expect(settledValue(editor), context).toBe(joined);

                // The removal is the one step there is: no shortcut ran as an update of its own after it.
                lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
                expect(settledValue(editor), `${context}, undone`).toBe(`${source}\n\n${RAW}`);

                editor.dispose();
            }
        }
    });

    it.each(KINDS)('TY1c: Enter, a paragraph or a line break over such a range completes no shortcut either, %s', async (_name, source, text) => {
        // A save trims the space that ends a block.
        const kept = joinedWithRaw(source, text).slice(0, -JOINED_RAW_REST.length).trimEnd();

        for (const split of SPLITS) {
            for (const [backward, inUpdate] of VARIANTS) {
                const context = `${split}, backward ${backward}, in an update ${inUpdate}`;
                const editor = selectIntoRaw(source, backward);

                remove(editor, split, inUpdate);
                // The text before the joint is still written as text, with its escapes.
                expect(settledValue(editor).startsWith(kept), context).toBe(true);

                editor.dispose();
            }
        }
    });

    it.each(KINDS)('TY1b: typing the character that completes %s over such a range completes it, as typing it after the removal does', async (_name, source, text) => {
        const joined = joinedWithRaw(source, text);

        for (const inUpdate of [true, false]) {
            const over = selectIntoRaw(source, false, 1);
            const typed = completingCharacter(over);

            dispatch(over, CONTROLLED_TEXT_INSERTION_COMMAND, typed, inUpdate);

            const stepped = selectIntoRaw(source, false, 1);

            remove(stepped, 'Delete', true);
            settledValue(stepped);
            dispatch(stepped, CONTROLLED_TEXT_INSERTION_COMMAND, typed, inUpdate);

            // Not the text the removal alone leaves: typing the character completed the shortcut.
            expect(settledValue(over), `in an update ${inUpdate}`).not.toBe(joined);
            expect(settledValue(over), `in an update ${inUpdate}`).toBe(settledValue(stepped));

            over.dispose();
            stepped.dispose();
        }
    });
});
