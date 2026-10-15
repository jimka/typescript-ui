// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// MarkdownEditor keeps a `:::` fence's opening line
// (plans/markdown-editor-fence-opening-line-kept.md): the words the viewer
// ignores (`::: tip Title`) survive an edited save, and a fence carrying them
// is never unwrapped by `setBlockAlignment(null)` / `setColumnCount(1)`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { $createRangeSelection, $getRoot, $isTextNode, $setSelection } from 'lexical';
import type { LexicalEditor, TextNode } from 'lexical';
import { $dfs } from '@lexical/utils';
import { fenceOpeningLabel } from '~/component/display/markdownAttributes';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { editorSurfaceModel, viewerModel } from './markdown-roundtrip/viewModel';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

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
 * Runs `edit` as one discrete update of the editor's document.
 *
 * @param editor - The editor.
 * @param edit - The edit; runs inside `editor.update`.
 */
function update(editor: MarkdownEditor, edit: () => void): void {
    lexicalOf(editor).update(edit, { discrete: true });
}

/**
 * Finds the document's first text node whose text is exactly `text`.
 *
 * @param text - The text.
 * @returns The text node.
 */
function $textNode(text: string): TextNode {
    const found = $dfs($getRoot()).find(({ node }) => $isTextNode(node) && node.getTextContent() === text);

    if (found === undefined) {
        throw new Error(`no text node "${text}"`);
    }

    return found.node as TextNode;
}

/**
 * Selects the whole of the text node holding exactly `text`.
 *
 * @param editor - The editor.
 * @param text - The node's text.
 */
function selectNode(editor: MarkdownEditor, text: string): void {
    update(editor, () => {
        const selection = $createRangeSelection();
        const key = $textNode(text).getKey();

        selection.anchor.set(key, 0, 'text');
        selection.focus.set(key, text.length, 'text');
        $setSelection(selection);
    });
}

/**
 * Appends `Z` to the text node holding exactly `text`.
 *
 * @param editor - The editor.
 * @param text - The node's text.
 */
function type(editor: MarkdownEditor, text: string): void {
    update(editor, () => {
        const node = $textNode(text);

        node.setTextContent(text + 'Z');
    });
}

/**
 * Checks a save against the viewer and a reload.
 *
 * @param editor - The edited editor.
 * @returns The saved Markdown.
 */
function checked(editor: MarkdownEditor): string {
    const saved = editor.getValue();

    expect(viewerModel(saved).blocks).toEqual(editorSurfaceModel(editor));
    expect(editorSurfaceModel(load(saved))).toEqual(editorSurfaceModel(editor));

    return saved;
}

/**
 * Loads `source`, types `Z` into the named text and returns the save.
 *
 * @param source - The Markdown.
 * @param text - The text node to type into.
 * @returns The saved Markdown.
 */
function typed(source: string, text: string): string {
    const editor = load(source);

    type(editor, text);

    return checked(editor);
}

/**
 * Loads `source`, selects the named text, runs `command` and returns the save.
 *
 * @param source - The Markdown.
 * @param text - The text node to select.
 * @param command - The command to run on the editor.
 * @returns The saved Markdown.
 */
function commanded(source: string, text: string, command: (editor: MarkdownEditor) => void): string {
    const editor = load(source);

    selectNode(editor, text);
    command(editor);

    return checked(editor);
}

describe('typing inside a fence keeps its opening line', () => {
    it.each([
        ['E1', '::: tip Title\nbody\n:::', 'body', '::: tip Title\nbodyZ\n:::'],
        ['E2', '::: tip\nbody\n:::', 'body', '::: tip\nbodyZ\n:::'],
        ['E3', '::: tip {align=right}\nbody\n:::', 'body', '::: tip {align=right}\nbodyZ\n:::'],
        ['E4', '::: {align=right} trailing words\nbody\n:::', 'body', '::: {align=right} trailing words\nbodyZ\n:::'],
        ['E5', '::: {align=right} {gap=1em}\nbody\n:::', 'body', '::: {align=right} {gap=1em}\nbodyZ\n:::'],
        ['E6', '::: tip Title\nleft\n|||\nright\n:::', 'left', '::: tip Title\nleftZ\n|||\nright\n:::'],
        ['E7', '::: columns Title\nbody\n:::', 'body', '::: columns Title\nbodyZ\n:::'],
        ['E8', ':::tip\nbody\n:::', 'body', ':::tip\nbodyZ\n:::'],
        ['E9', '::: tip *Em* `code` [l](/x)\nbody\n:::', 'body', '::: tip *Em* `code` [l](/x)\nbodyZ\n:::'],
        ['E10', '::: tip {broken\nbody\n:::', 'body', '::: tip {broken\nbodyZ\n:::'],
    ])('%s', (_name, source, text, expected) => {
        expect(typed(source, text)).toBe(expected);
    });
});

describe('nested fences and fences in containers keep their opening lines', () => {
    it.each([
        ['N1', '::: outer O\n::: inner I\ninside\n:::\n:::', 'inside', '::: outer O\n::: inner I\ninsideZ\n:::\n:::'],
        [
            'N2', '::: outer O\nouter text\n\n::: inner I\ninside\n:::\n:::', 'outer text',
            '::: outer O\nouter textZ\n\n::: inner I\ninside\n:::\n:::',
        ],
        ['N3', '- item\n\n  ::: tip T\n  body\n  :::', 'body', '- item\n\n  ::: tip T\n  bodyZ\n  :::'],
        ['N4', '- ::: tip T\n  body\n  :::', 'body', '- ::: tip T\n  bodyZ\n  :::'],
    ])('%s', (_name, source, text, expected) => {
        expect(typed(source, text)).toBe(expected);
    });
});

describe('the standard form is unchanged for a fence without an authored label', () => {
    it.each([
        ['K1', '::: {align=right}\nbody\n:::', 'body', '::: {align=right}\nbodyZ\n:::'],
        ['K2', '::: {}\nbody\n:::', 'body', '::: {}\nbodyZ\n:::'],
        ['K3', '::: columns {gap=2em}\nleft\n|||\nright\n:::', 'left', '::: columns {gap=2em}\nleftZ\n|||\nright\n:::'],
    ])('%s', (_name, source, text, expected) => {
        expect(typed(source, text)).toBe(expected);
    });

    it('K4: `columns` is not a label, so a merge to one column still unwraps', () => {
        expect(commanded('::: columns\nleft\n|||\nright\n:::', 'left', (editor) => editor.setColumnCount(1))).toBe('left\n\nright');
    });
});

describe('commands keep a fence\'s opening line', () => {
    it('C1: a format command', () => {
        expect(commanded('::: tip Title\nbody\n:::', 'body', (editor) => editor.toggleBold())).toBe('::: tip Title\n**body**\n:::');
    });

    it.each([
        ['C2', '::: tip Title\nbody\n:::', '::: tip Title {align=center}\nbody\n:::'],
        ['C3', '::: tip {align=right}\nbody\n:::', '::: tip {align=center}\nbody\n:::'],
        ['C4', '::: {align=right} trailing words\nbody\n:::', '::: {align=center} trailing words\nbody\n:::'],
    ])('%s: setBlockAlignment("center")', (_name, source, expected) => {
        expect(commanded(source, 'body', (editor) => editor.setBlockAlignment('center'))).toBe(expected);
    });

    it.each([
        ['C5', '::: tip {align=right}\nbody\n:::', '::: tip\nbody\n:::'],
        ['C6', '::: {align=right} trailing words\nbody\n:::', '::: trailing words\nbody\n:::'],
        ['C7', '::: {align=right} {gap=1em}\nbody\n:::', '::: {} {gap=1em}\nbody\n:::'],
        ['C8', '::: tip Title\nbody\n:::', '::: tip Title\nbody\n:::'],
    ])('%s: setBlockAlignment(null)', (_name, source, expected) => {
        expect(commanded(source, 'body', (editor) => editor.setBlockAlignment(null))).toBe(expected);
    });

    it.each([
        ['C12', '::: tip{align=right}Title\nbody\n:::'],
        ['C13', '::: tip {align=right}Title\nbody\n:::'],
    ])('%s: dropping a group glued to the next word keeps the words apart', (_name, source) => {
        const saved = commanded(source, 'body', (editor) => editor.setBlockAlignment(null));

        expect(saved).toBe('::: tip Title\nbody\n:::');
        expect(fenceOpeningLabel(saved.split('\n')[0]!.slice(3))).toBe('tip Title');
    });

    it('C14: dropping a group right after `:::` keeps the space before the next word', () => {
        const saved = commanded('::: {align=right}Title\nbody\n:::', 'body', (editor) => editor.setBlockAlignment(null));

        expect(saved).toBe('::: Title\nbody\n:::');
        expect(fenceOpeningLabel(saved.split('\n')[0]!.slice(3))).toBe('Title');
    });

    it('C9: setColumnCount(1) keeps a labelled fence', () => {
        expect(commanded('::: tip Title\nleft\n|||\nright\n:::', 'left', (editor) => editor.setColumnCount(1)))
            .toBe('::: tip Title\nleft\n\nright\n:::');
    });

    it('C10: setColumnCount(3) keeps the label', () => {
        expect(commanded('::: tip Title\nbody\n:::', 'body', (editor) => editor.setColumnCount(3)))
            .toBe('::: tip Title\nbody\n|||\n\n|||\n\n:::');
    });

    it('C11: a nested labelled fence is not unwrapped', () => {
        const source = '::: outer O\n::: inner I\ninside\n:::\n:::';

        expect(commanded(source, 'inside', (editor) => editor.setBlockAlignment(null))).toBe(source);
    });
});

describe('fenceOpeningLabel', () => {
    it.each([
        ['U1', ' tip Title', 'tip Title'],
        ['U2', 'tip{align=right}Title', 'tip Title'],
        ['U3', ' columns {gap=2em}', 'columns'],
        ['U4', ' {align=right}', ''],
        ['U5', ' {a=1} {b=2}', '{b=2}'],
        ['U6', '', ''],
    ])('%s', (_name, input, expected) => {
        expect(fenceOpeningLabel(input)).toBe(expected);
    });
});
