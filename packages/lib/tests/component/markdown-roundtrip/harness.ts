import { expect } from 'vitest';
import type { LexicalEditor } from 'lexical';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $serializeMarkdown } from '~/component/editor/markdownSerializer';
import type { CorpusCase, HarnessCheck } from './corpus/types';

/**
 * Loads `source` into a headless `MarkdownEditor` and saves it again. Does not catch: a throw fails the check.
 *
 * @param source - The Markdown to load.
 * @returns The loaded editor and the Markdown it saves.
 */
export function loadAndSave(source: string): { editor: MarkdownEditor; saved: string } {
    const editor = new MarkdownEditor();

    editor.setValue(source);

    return { editor, saved: editor.getValue() };
}

/**
 * The editor's standard-form save, ignoring the source map: every block written as the serializer writes it.
 *
 * @param editor - A loaded editor.
 * @returns The Markdown in the standard form.
 */
export function canonicalSave(editor: MarkdownEditor): string {
    const lexicalEditor = (editor as unknown as { _editor: LexicalEditor | null })._editor;

    if (lexicalEditor === null) {
        throw new Error('The MarkdownEditor has no Lexical editor yet; call setValue first.');
    }

    return lexicalEditor.read(() => $serializeMarkdown());
}

/**
 * Names a check's test, marking it when the case lists the check as a known divergence.
 *
 * @param testCase - The corpus case.
 * @param check - The check.
 * @returns The check name, with the divergence id appended when one is listed.
 */
export function checkTitle(testCase: CorpusCase, check: HarnessCheck): string {
    const id = testCase.known?.[check];

    return id === undefined ? check : `${check} (known divergence: ${id})`;
}

/**
 * Asserts one check. An unlisted check must hold; a listed check must not, so a fix turns its test red until the
 * entry is removed.
 *
 * @param testCase - The corpus case.
 * @param check - The check.
 * @param actual - What the editor produced.
 * @param expected - What the check expects.
 */
export function assertCheck(testCase: CorpusCase, check: HarnessCheck, actual: unknown, expected: unknown): void {
    const id = testCase.known?.[check];

    if (id === undefined) {
        expect(actual).toEqual(expected);

        return;
    }

    const message = `${testCase.name}: the '${check}' check now holds — remove its known divergence '${id}' from the corpus`;

    expect(actual, message).not.toEqual(expected);
}
