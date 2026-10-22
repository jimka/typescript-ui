import { expect } from 'vitest';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
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
