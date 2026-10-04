import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { $createParagraphNode, $createTextNode, $getRoot, $isTextNode, REDO_COMMAND, UNDO_COMMAND } from 'lexical';
import type { ElementNode, LexicalEditor, TextNode } from 'lexical';
import { $dfs } from '@lexical/utils';
import { $createCodeNode } from '@lexical/code';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $isMarkdownRawBlockNode, $isMarkdownSourceTextNode } from '~/component/editor/markdownSourceNodes';
import { lexMarkdownLinkDefinitions } from '~/component/display/markdownExtensions';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { canonicalSave } from './markdown-roundtrip/harness';
import { editorSurfaceModel, viewerModel } from './markdown-roundtrip/viewModel';

// File reading lives in a plain-ESM helper: the test program is deliberately
// Node-types-free, so `node:fs` cannot be imported here. See the helper for why.
import { readDemoEditorSample } from '../helpers/readDemoSample.mjs';

// Wraps the definitions lexer in a spy that still lexes, so a test can count
// how often a save reads the definitions; every other test sees it unchanged.
vi.mock('~/component/display/markdownExtensions.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~/component/display/markdownExtensions.js')>();

    return { ...actual, lexMarkdownLinkDefinitions: vi.fn(actual.lexMarkdownLinkDefinitions) };
});

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
 * The MD Editor demo's own sample, read out of the demo panel's source
 * (`src/typescript/MarkdownEditorPanel.ts`): the tests below test the
 * document the demo shows, not a copy that could drift from it.
 */
const SAMPLE = readDemoEditorSample();

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
 * The first plain text node (not a kept-source node) whose text is exactly `text`. Must run inside a read or update.
 *
 * @param text - The node's text.
 * @returns The node.
 */
function $textNode(text: string): TextNode {
    const node = $dfs().map(({ node: candidate }) => candidate)
        .find((candidate) => $isTextNode(candidate) && !$isMarkdownSourceTextNode(candidate) && candidate.getTextContent() === text);

    if (node === undefined || !$isTextNode(node)) {
        throw new Error(`No text node holds '${text}'.`);
    }

    return node;
}

/**
 * Appends `suffix` to the first text node holding exactly `text`, as typing at its end would.
 *
 * @param editor - The editor.
 * @param text - The text node's text.
 * @param suffix - The text to append.
 */
function append(editor: MarkdownEditor, text: string, suffix: string): void {
    update(editor, () => {
        const node = $textNode(text);

        node.setTextContent(node.getTextContent() + suffix);
    });
}

describe('an unedited document saves as loaded', () => {
    const sources = [SAMPLE, '* a\n* b', 'a | b\n--- | ---\n1 | 2', 'Para one\nwrapped.\n', '    code\n', 'Title\n===\n'];

    it.each(sources)('P1. returns %j unchanged', (source) => {
        expect(load(source).getValue()).toBe(source);
    });

    it.each(['', '\n\n'])('P2. returns the empty document %j unchanged', (source) => {
        expect(load(source).getValue()).toBe(source);
    });

    it('P10. writes \\r\\n line endings as \\n', () => {
        expect(load('a\r\nb').getValue()).toBe('a\nb');
    });

    it('P11. keeps a run of duplicate definitions and the trailing newline', () => {
        const source = '[a]\n\n[a]: https://one\n[a]: https://two\n';

        expect(load(source).getValue()).toBe(source);
    });

    it('P12. keeps the source across a switch to source mode and back', () => {
        const editor = load('* a');

        editor.setMode('source');
        expect(editor.getValue()).toBe('* a');

        editor.setMode('wysiwyg');
        expect(editor.getValue()).toBe('* a');
    });
});

describe('the MD Editor demo sample', () => {
    it('P18. reads its table\'s column width from the delimiter row, in the viewer and the editor', () => {
        const viewerTable = viewerModel(SAMPLE).blocks.find((block) => block.kind === 'table');
        const editorTable = editorSurfaceModel(load(SAMPLE)).find((block) => block.kind === 'table');

        expect(viewerTable).toMatchObject({
            widths: [160, null],
            header: [
                { align: 'left',   runs: [{ text: 'Column' }] },
                { align: 'center', runs: [{ text: 'Aligned' }] },
            ],
        });

        expect(editorTable).toEqual(viewerTable);
    });

    it('P19. writes its table in the serializer\'s standard form', () => {
        const table = '| Column | Aligned |\n| :--- {width=160} | :---: |\n| Tables | yes |\n| Merge | << |';

        expect(SAMPLE).toContain(`\n\n${table}\n\n`);
        expect(canonicalSave(load(table))).toBe(table);
    });
});

describe('a block that shows nothing keeps its source while unedited', () => {
    // A paragraph holding only a link with empty text loads as an empty paragraph: its standard form writes nothing.
    it.each(['[](u)', 'p\n\n[](u)\n\nq', '[][ref]\n\n[ref]: /x'])('P17. returns %j unchanged', (source) => {
        expect(load(source).getValue()).toBe(source);
    });

    it('P17. keeps it when a neighbour is edited', () => {
        const editor = load('p\n\n[](u)\n\nq');

        append(editor, 'p', '!');

        expect(editor.getValue()).toBe('p!\n\n[](u)\n\nq');
    });
});

describe('an edit rewrites only the edited block', () => {
    it('P3. writes one blank line around an edited block and keeps the trailing newline', () => {
        const editor = load('# H\n\n\n\npara\n');

        append(editor, 'para', '!');

        expect(editor.getValue()).toBe('# H\n\npara!\n');
    });

    it('P4. keeps an unedited list as written before an edited paragraph', () => {
        const editor = load('* a\n* b\n\ntext');

        append(editor, 'text', '!');

        expect(editor.getValue()).toBe('* a\n* b\n\ntext!');
    });

    it('P5. writes an edited list in the standard form and keeps the paragraph after it', () => {
        const editor = load('* a\n* b\n\ntext');

        append(editor, 'a', '!');

        expect(editor.getValue()).toBe('* a!\n* b\n\ntext');
    });

    it('P6. keeps an edited paragraph\'s soft line breaks', () => {
        const editor = load('first\nwrapped\n\nsecond');

        append(editor, 'wrapped', '!');

        expect(editor.getValue()).toBe('first\nwrapped!\n\nsecond');
    });

    it('P7. writes two lists of different markers as loaded, each its own list', () => {
        expect(load('- a\n+ b').getValue()).toBe('- a\n+ b');
    });

    it('P8. writes a reference link inline once its definition is edited', () => {
        const editor = load('[x]\n\n[x]: https://one');

        update(editor, () => {
            const raw = $getRoot().getChildren().find($isMarkdownRawBlockNode)!;

            raw.clear();
            raw.append($createTextNode('[x]: https://two'));
        });

        expect(editor.getValue()).toBe('[x](https://one)\n\n[x]: https://two');
    });

    it('P9. returns the source again once an edit is undone', () => {
        const editor = load('* a\n\ntext');

        append(editor, 'text', '!');
        expect(editor.getValue()).toBe('* a\n\ntext!');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe('* a\n\ntext');
    });
});

describe('a block is written as its source only where that keeps its meaning', () => {
    it('P13. writes an indented block after an edited list in the standard form, so it does not join the list', () => {
        const editor = load('  - n\n\n  ***');

        append(editor, 'n', '!');

        const saved = editor.getValue();

        expect(saved).toBe('- n!\n\n***');
        expect(viewerModel(saved).blocks.map((block) => block.kind)).toEqual(viewerModel('  - n\n\n  ***').blocks.map((block) => block.kind));
    });

    it('P14. keeps an indented code block as written after an edited paragraph', () => {
        const editor = load('para\n\n    code');

        append(editor, 'para', '!');

        expect(editor.getValue()).toBe('para!\n\n    code');
    });

    it('P15. closes an unclosed code fence once a block is added after it', () => {
        const editor = load('```\ncode');

        expect(editor.getValue()).toBe('```\ncode');

        update(editor, () => {
            $getRoot().append($createParagraphNode().append($createTextNode('new')));
        });

        expect(editor.getValue()).toBe('```\ncode\n```\n\nnew');
    });

    it('P16. keeps text that was not a link as text once a definition for its label is added', () => {
        const editor = load('see [y]\n\n[x]: https://one');

        update(editor, () => {
            const raw = $getRoot().getChildren().find($isMarkdownRawBlockNode)!;

            raw.clear();
            raw.append($createTextNode('[y]: https://one'));
        });

        expect(editor.getValue()).toBe('see \\[y\\]\n\n[y]: https://one');
    });
});

describe('whole-stack review fixes: undo across an import', () => {
    const DOC = '* a\n* b\n\n_em_ text\n\n| x | y |\n|---|---|\n| 1 | 2 |';

    /**
     * Appends a paragraph holding `text` at the end of the document, as typing a new paragraph would.
     *
     * @param editor - The editor.
     * @param text - The paragraph's text.
     */
    function appendParagraph(editor: MarkdownEditor, text: string): void {
        update(editor, () => {
            $getRoot().append($createParagraphNode().append($createTextNode(text)));
        });
    }

    it('keeps the unedited blocks as written after an undo past a switch to source mode and back', () => {
        const editor = load(DOC).markClean();

        appendParagraph(editor, 'new');
        editor.setMode('source');
        editor.setMode('wysiwyg');
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(`${DOC}\n\nnew`);
        expect(editor.isDirty()).toBe(true);

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(DOC);
        expect(editor.isDirty()).toBe(false);
    });

    it('returns the first document as written after setValue twice and an undo', () => {
        const editor = load(DOC).markClean();

        editor.setValue('# other\n\n- x\n- y\n');
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(DOC);
        expect(editor.isDirty()).toBe(false);
    });

    it('keeps each import\'s own text around the document once an undo returns to it', () => {
        const first = '\n\n# one\n\npara\n';
        const editor = load(first);

        editor.setValue('# two');
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(first);

        lexicalOf(editor).dispatchCommand(REDO_COMMAND, undefined);

        expect(editor.getValue()).toBe('# two');
    });

    it('returns a blank document\'s own text after an undo past a later import', () => {
        const editor = load('\n\n');

        editor.setValue('# two');
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe('\n\n');
    });
});

describe('whole-stack review fixes: editing a definition', () => {
    /**
     * Replaces the text of the raw block holding `[label]: …` with `text`.
     *
     * @param editor - The editor.
     * @param label - The label of the definition the raw block opens with.
     * @param text - The raw block's new text.
     */
    function rewriteDefinition(editor: MarkdownEditor, label: string, text: string): void {
        update(editor, () => {
            const raw = $getRoot().getChildren().filter($isMarkdownRawBlockNode)
                .find((node) => node.getTextContent().startsWith(`[${label}]:`))!;

            raw.clear();
            raw.append($createTextNode(text));
        });
    }

    it('keeps every block as written in a document with no reference link', () => {
        const source = '_em_ text\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\nTitle\n===\n\n[unused]: https://one\n';
        const editor = load(source);

        rewriteDefinition(editor, 'unused', '[unused]: https://two');

        expect(editor.getValue()).toBe(source.replace('https://one', 'https://two'));
    });

    it('writes only the block whose reference reads differently in the standard form', () => {
        const editor = load('[ref] and _em_\n\n_em_ alone\n\nsee [other] and _em_\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n[ref]: https://one');

        rewriteDefinition(editor, 'ref', '[ref]: https://two');

        expect(editor.getValue()).toBe(
            '[ref](https://one) and *em*\n\n_em_ alone\n\nsee [other] and _em_\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n[ref]: https://two',
        );
    });

    it('writes text that a new definition would turn into a link in the standard form, and nothing else', () => {
        const editor = load('see [y] and _em_\n\n_em_ alone\n\n[x]: https://one');

        rewriteDefinition(editor, 'x', '[y]: https://one');

        expect(editor.getValue()).toBe('see \\[y\\] and *em*\n\n_em_ alone\n\n[y]: https://one');
    });
});

describe('stack fuzz round: a block holding a reference link reads back with the document\'s definitions', () => {
    it('a word typed right before a bold shortcut, whose delimiter cannot open there, takes the bold off it', () => {
        // The shortcut form keeps the bold outside its brackets, so `fuzz**[ref]**` cannot open. The read-back lexes the
        // block with the document's definitions, as the viewer reads the saved document, so the editor sees it.
        const editor = load('A **[ref]**\n\n[ref]: https://e.com');

        append(editor, 'A ', 'fuzz');

        const saved = editor.getValue();

        // Its text no longer as loaded (its bold came off), the reference is written in the full form.
        expect(saved).toBe('A fuzz[ref][ref]\n\n[ref]: https://e.com');
        expect(editorSurfaceModel(editor)).toEqual(viewerModel(saved).blocks);
    });

    it('a bare URL after an empty reference link, in a heading, keeps the heading\'s id once the heading is edited', () => {
        // `[][R1]` is kept as written: no reference link node stands for it, yet its reading needs the definitions.
        const editor = load('## [][R1]www.t\n\n[R1]: /one');

        update(editor, () => {
            $getRoot().getFirstChildOrThrow<ElementNode>().append($createTextNode(' w'));
        });

        expect(editor.getValue()).toBe('## [][R1]www.t w\n\n[R1]: /one');
    });

    it('a bold shortcut after a space keeps its form and its bold (control)', () => {
        const editor = load('A **[ref]**\n\n[ref]: https://e.com');

        append(editor, 'A ', 'b ');

        expect(editor.getValue()).toBe('A b **[ref]**\n\n[ref]: https://e.com');
    });
});

describe('whole-stack review fixes: saving cost', () => {
    it('reads the definitions with one lex per save when the document holds reference links', () => {
        const editor = load('[ref] and _em_\n\n_em_ alone\n\n[ref]: https://one');
        const lex = vi.mocked(lexMarkdownLinkDefinitions);

        lex.mockClear();
        editor.getValue();

        expect(lex).toHaveBeenCalledTimes(1);
    });
});

describe('stack fuzz round 2: a block whose source opens a definition label keeps its reading', () => {
    /**
     * Replaces the paragraph holding exactly `text` with a code block holding `code`.
     *
     * @param editor - The editor.
     * @param text - The paragraph's text.
     * @param code - The code block's text.
     */
    function replaceWithCode(editor: MarkdownEditor, text: string, code: string): void {
        update(editor, () => {
            $textNode(text).getParentOrThrow().replace($createCodeNode().append($createTextNode(code)));
        });
    }

    it('writes a paragraph opening an unclosed label in the standard form once the block after it closes the label', () => {
        const editor = load('[fo\n\nbar');

        replaceWithCode(editor, 'bar', 'o]: /url');

        const saved = editor.getValue();

        expect(saved).toBe('\\[fo\n\n```\no]: /url\n```');
        expect(viewerModel(saved).blocks.map((block) => block.kind)).toEqual(['paragraph', 'code']);
    });

    it('does so when a later block, not its neighbour, closes the label', () => {
        const editor = load('[fo\n\nbar\n\nbaz');

        replaceWithCode(editor, 'baz', 'o]: /url');

        const saved = editor.getValue();

        expect(saved).toBe('\\[fo\n\nbar\n\n```\no]: /url\n```');
        expect(viewerModel(saved).blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph', 'code']);
    });

    it('writes a paragraph opening an unclosed definition title in the standard form once a block after it closes the title', () => {
        // `marked` reads a definition's title across a blank line: `"` closing it in a later block makes the two one definition.
        const editor = load('[x]: /a\n\n[x]: </b> "\n\nbar');

        update(editor, () => {
            $textNode('bar').setTextContent('q"');
        });

        const saved = editor.getValue();

        expect(saved).toBe('[x]: /a\n\n[x][]: </b> "\n\nq"');
        expect(viewerModel(saved).blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph']);
    });

    it('keeps such a paragraph as written while nothing after it closes the title (control)', () => {
        const editor = load('[x]: /a\n\n[x]: </b> "\n\nbar');

        append(editor, 'bar', '!');

        expect(editor.getValue()).toBe('[x]: /a\n\n[x]: </b> "\n\nbar!');
    });

    it('keeps such a paragraph as written while nothing after it closes the label (control)', () => {
        const editor = load('[fo\n\nbar');

        append(editor, 'bar', '!');

        expect(editor.getValue()).toBe('[fo\n\nbar!');
    });
});
