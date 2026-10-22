// @vitest-environment jsdom
//
// The undo and redo keys a read-only `MarkdownEditor` stops are Lexical's
// own, and Lexical decides once, as it is loaded, whether the keyboard is an
// Apple one. This file gives the platform before anything is loaded, so that
// the Apple half of `isUndoOrRedoKey` runs; the other half is row R16 of
// `markdown-editor-readonly-mounted.test.ts`. It must load no module ahead of
// the `vi.hoisted` block.

import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
    Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true });
});

import { IS_APPLE } from 'lexical';
import { isUndoOrRedoKey } from '~/component/editor/markdownReadOnly';

/** Builds a `keydown` with the given modifier keys held. */
function keydown(key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }): KeyboardEvent {
    return new KeyboardEvent('keydown', { key, ...modifiers });
}

describe('MarkdownEditor read-only: the undo and redo keys of an Apple keyboard', () => {
    it('K0: Lexical was loaded as on an Apple platform', () => {
        expect(IS_APPLE).toBe(true);
    });

    it('K1: Cmd+Z is the undo key and Cmd+Shift+Z the redo key', () => {
        expect(isUndoOrRedoKey(keydown('z', { metaKey: true }))).toBe(true);
        expect(isUndoOrRedoKey(keydown('z', { metaKey: true, shiftKey: true }))).toBe(true);
        // As a keyboard reports the letter with Shift held.
        expect(isUndoOrRedoKey(keydown('Z', { metaKey: true, shiftKey: true }))).toBe(true);
    });

    it('K2: an Apple keyboard has no Cmd+Y, and its Ctrl is not the key that undoes', () => {
        const others: [string, Parameters<typeof keydown>[1]][] = [
            ['y', { metaKey: true }], ['y', { ctrlKey: true }], ['z', { ctrlKey: true }], ['z', { ctrlKey: true, shiftKey: true }],
            ['z', {}], ['z', { metaKey: true, altKey: true }], ['z', { metaKey: true, ctrlKey: true }], ['a', { metaKey: true }],
            // Option+Backspace deletes a word on an Apple keyboard: an edit, which the surface refuses as one. It is
            // the undo key of a browser on Windows only.
            ['Backspace', { altKey: true }], ['Backspace', { altKey: true, shiftKey: true }],
        ];

        for (const [key, modifiers] of others) {
            expect(isUndoOrRedoKey(keydown(key, modifiers)), `${JSON.stringify(modifiers)}+${key}`).toBe(false);
        }
    });
});
