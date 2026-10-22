// @vitest-environment jsdom
//
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The key that toggles the task items a selection touches is Cmd+Enter on an Apple keyboard and Ctrl+Enter elsewhere
// (plans/markdown-task-lists.md). Lexical decides once, as it is loaded, whether the keyboard is an Apple one, so this
// file gives the platform before anything is loaded: the other platform's rows are in
// `markdown-editor-task-items.test.ts`. It must load no module ahead of the `vi.hoisted` block.

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.hoisted(() => {
    Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true });
});

import { $getRoot, IS_APPLE, KEY_ENTER_COMMAND } from 'lexical';
import type { LexicalEditor } from 'lexical';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { DOM } from '~/core/DOM';

afterEach(() => DOM.reset());

/**
 * Loads a document into an editor with no mounted surface and puts a caret in a text.
 *
 * @param source - The Markdown.
 * @param text - The exact text of the text node the caret goes in.
 * @returns The editor and its Lexical editor.
 */
function loaded(source: string, text: string): { editor: MarkdownEditor; lexical: LexicalEditor } {
    const editor = new MarkdownEditor();

    editor.setValue(source);

    const lexical = (editor as unknown as { _editor: LexicalEditor })._editor;

    lexical.update(() => {
        $getRoot().getAllTextNodes().find((node) => node.getTextContent() === text)!.select(1, 1);
    }, { discrete: true });

    return { editor, lexical };
}

/**
 * Presses Enter with the given modifier keys.
 *
 * @param lexical - The editor.
 * @param modifiers - The keys held.
 */
function pressEnter(lexical: LexicalEditor, modifiers: { ctrlKey?: boolean; metaKey?: boolean }): void {
    lexical.dispatchCommand(KEY_ENTER_COMMAND, {
        ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault: () => {}, ...modifiers,
    } as unknown as KeyboardEvent);
}

describe('Cmd+Enter on an Apple keyboard', () => {
    it('is loaded as on an Apple platform', () => {
        expect(IS_APPLE).toBe(true);
    });

    it('Cmd alone toggles the task item the caret is in', () => {
        const { editor, lexical } = loaded('- [ ] one', 'one');

        pressEnter(lexical, { metaKey: true });

        expect(editor.getValue()).toBe('- [x] one');
    });

    it('Ctrl alone toggles nothing', () => {
        const { editor, lexical } = loaded('- [ ] one', 'one');

        pressEnter(lexical, { ctrlKey: true });

        expect(editor.getValue()).not.toContain('[x]');
    });
});
