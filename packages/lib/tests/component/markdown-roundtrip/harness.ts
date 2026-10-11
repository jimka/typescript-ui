import { expect } from 'vitest';
import type { LexicalEditor } from 'lexical';
import type { Links } from 'marked';
import { lexMarkdownLinkDefinitions } from '~/component/display/markdownExtensions';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $readDefinitions, $serializeMarkdown } from '~/component/editor/markdownSerializer';
import type { CorpusCase, HarnessCheck } from './corpus/types';

/** The label of the line a save writes between two lists it keeps apart (`[//]: #`). */
const SEPARATOR_LABEL = '//';

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
 * The link reference definitions the editor reads off its document.
 *
 * @param editor - A loaded editor.
 * @returns The definitions, by label.
 */
export function editorDefinitions(editor: MarkdownEditor): Links {
    const lexicalEditor = (editor as unknown as { _editor: LexicalEditor })._editor;

    return lexicalEditor.read(() => $readDefinitions(true).all);
}

/**
 * The link reference definitions the viewer reads off a save, without the label of the line a save writes between
 * two lists it keeps apart when that line alone defines it: the line is no part of the editor's document.
 *
 * @param saved - The Markdown a save wrote.
 * @param own - The definitions the editor reads off its document ({@link editorDefinitions}).
 * @returns The definitions, by label.
 */
export function viewerDefinitions(saved: string, own: Links): Links {
    const read = lexMarkdownLinkDefinitions(saved);
    const entries = Object.entries(read).filter(([label]) => label !== SEPARATOR_LABEL || Object.hasOwn(own, SEPARATOR_LABEL));

    return Object.assign(Object.create(null) as Links, Object.fromEntries(entries));
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
