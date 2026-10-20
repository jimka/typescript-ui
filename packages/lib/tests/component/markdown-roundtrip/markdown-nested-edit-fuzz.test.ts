import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { $createParagraphNode, $createTextNode, $isTextNode } from 'lexical';
import type { LexicalEditor, LexicalNode, TextNode } from 'lexical';
import { $dfs } from '@lexical/utils';
import { $createListItemNode, $isListItemNode } from '@lexical/list';
import { $createTableCellNode, $createTableRowNode, $isTableCellNode, $isTableRowNode, TableCellHeaderStates } from '@lexical/table';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $isMarkdownQuoteNode } from '~/component/editor/markdownQuoteNode';
import { $createMarkdownListItemTextNode } from '~/component/editor/markdownListItemNode';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { canonicalSave, editorDefinitions, loadAndSave, viewerDefinitions } from './harness';
import { editorSurfaceModel, viewerModel } from './viewModel';
import { CORPUS } from './corpus';
import type { CorpusCase, HarnessCheck } from './corpus/types';

// A deterministic, bounded fuzz of edits inside a block: random edits of a list item, a table row or cell, a block of a quote and the text
// in them, through the editor's Lexical API, over every corpus document and the nested documents, so a save that
// writes the unedited parts of an edited block as their source stays correct. Source-mode commands, which save through the
// same serializer, are run over the same documents. Each case's random stream is seeded from
// its name, as the edit fuzz's is, so a failure reproduces on its own.

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** The fixed seed every case's random stream starts from; changing it explores other edits. */
const FUZZ_SEED = 0x5eed;

/** Edit sequences per case: with some 580 corpus cases and the nested documents this keeps the file to seconds. */
const SEQUENCES_PER_CASE = 8;

/** The most edits one sequence makes: one or two, as the edit fuzz makes. */
const MAX_EDITS_PER_SEQUENCE = 2;

/** The edits the fuzz makes. */
type EditKind = 'appendText' | 'insertItem' | 'deleteItem' | 'insertRow' | 'deleteRow' | 'insertCell' | 'deleteCell' | 'insertQuoteBlock' | 'deleteQuoteBlock';

/** The edits, in the order a random index picks among the ones that apply. */
const EDIT_KINDS: readonly EditKind[] = ['appendText', 'insertItem', 'deleteItem', 'insertRow', 'deleteRow', 'insertCell', 'deleteCell', 'insertQuoteBlock', 'deleteQuoteBlock'];

/**
 * Documents in forms the editor does not save in: nested lists, hand-padded tables, tilde fences, columns. The last
 * ones are those a wider fuzz found failing: a number with leading zeros, a merge marker held as text, a table and a
 * code block standing directly in a column, and a nested list under a bare marker.
 */
const NESTED_SOURCES: readonly string[] = [
    '* one\n* two\n* three',
    '+ one\n\n+ two\n\n+ three',
    '1) one\n2) two\n3) three',
    '7. one\n8. two\n9. three',
    '- one\n    - inner one\n    - inner two\n- two',
    Array.from({ length: 6 }, (_, index) => `* item ${index + 1}\n    * sub ${index + 1}`).join('\n'),
    '- a\nb\n- c',
    '- a\n  1. x\n  2. y\n- b',
    '1.  one\n    more\n\n    - x\n2.  two',
    '| a   | bb |\n|-----|----|\n| 1   | 2  |\n| 3   | 4  |',
    'a | b\n--|--\n1 | 2\n3 | 4',
    '| a | b | c |\n| --- | --- | --- |\n| x | << | y |\n| p | q | r |',
    '~~~js\ncode\n~~~\n\ntext',
    '- item\n\n  ~~~\n  code\n  ~~~\n- next',
    '::: columns\nleft _x_\n\n* p\n* q\n\n|||\n\nright\n:::',
    '::: columns\n- a\n    - b\n|||\nc\n:::',
    '- a\n    - x\n    -\n      ---',
    '007. a\n008. b\n\n         code\n009. c',
    '08. a\n09. b\n\n         code\n10. c',
    '| a  | b  |\n|----|----|\n| 1  | ^^ |\n| 3  | 4  |',
    '- item\n\n  | a  | b  |\n  |----|----|\n  | 1  | ^^ |\n  | 3  | 4  |',
    '::: columns\n| a  | b  |\n|----|----|\n| 1  | ^^ |\n|||\n- x\n    - y\n:::',
    '::: columns\n| a  | b |\n|----|---|\n| 1  | 2 |\n|||\n~~~\ncode\n~~~\n:::',
    '>a\n>\n>b _c_\n>\n>  * x\n>  * y',
    '> > p\n> >\n> > q\n>\n> r',
    '- a\n\n  >q\n  >\n  >r\n- b',
    '::: columns\n> l\n>\n> m\n|||\nn\n:::',
    '> ~~~\n> code\n> ~~~\n>\n> | a  | b |\n> |----|---|\n> | 1  | 2 |',
    '>  1. one\n>  2. two\n>\n>  text',
    '- a\n\n  ***\n- b',
    '> a\n>\n> ---\n>\n> b',
    '::: columns\n---\n|||\nb\n:::',
];

/** The documents the fuzz runs over: the corpus, then the nested documents. */
const CASES: readonly CorpusCase[] = [
    ...CORPUS,
    ...NESTED_SOURCES.map((source, index): CorpusCase => ({ name: `nested document ${index + 1}`, source })),
];

/**
 * A seeded pseudo-random stream (mulberry32): small, fast and the same on every run.
 * The constants are mulberry32's own (Tommy Ettinger's), which give it a full 2^32 period.
 *
 * @param seed - The stream's seed.
 * @returns A function returning the next number in [0, 1).
 */
function randomStream(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), state | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Hashes a case name into a seed (FNV-1a, 32-bit; its offset basis and prime are the algorithm's), so each case has
 * its own stream whatever order the cases run in.
 *
 * @param name - The case name.
 * @returns The case's seed.
 */
function seedOf(name: string): number {
    let hash = 0x811c9dc5 ^ FUZZ_SEED;

    for (let index = 0; index < name.length; index++) {
        hash = Math.imul(hash ^ name.charCodeAt(index), 0x01000193);
    }

    return hash >>> 0;
}

/**
 * Reaches the private Lexical editor.
 *
 * @param editor - The Markdown editor.
 * @returns Its Lexical editor.
 */
function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

/**
 * Picks a random element.
 *
 * @param random - The case's random stream.
 * @param list - A non-empty list.
 * @returns One of its elements.
 */
function pick<T>(random: () => number, list: readonly T[]): T {
    return list[Math.floor(random() * list.length)]!;
}

/**
 * A table cell of one paragraph holding a word.
 *
 * @param word - The word.
 * @param header - Whether the cell is a header cell.
 * @returns The cell.
 */
function cellWith(word: string, header: boolean): LexicalNode {
    return $createTableCellNode(header ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS)
        .append($createParagraphNode().append($createTextNode(word)));
}

/**
 * The text nodes a user can type into: an atomic (token) or segmented node — a kept-source run, which stands for
 * its source as a whole — takes no typed text.
 *
 * @returns The editable text nodes, in document order.
 */
function $editableTextNodes(): TextNode[] {
    return $dfs().map(({ node }) => node).filter($isTextNode).filter((text) => !text.isToken() && !text.isSegmented());
}

/**
 * The edits that apply to the document now.
 *
 * @returns The kinds of edit that have something to edit.
 */
function $applicableEdits(): EditKind[] {
    const nodes = $dfs().map(({ node }) => node);
    const hasSiblings = (node: LexicalNode): boolean => (node.getParent()?.getChildrenSize() ?? 0) > 1;
    const rows = nodes.filter($isTableRowNode);

    return EDIT_KINDS.filter((kind) => {
        switch (kind) {
            case 'appendText': return $editableTextNodes().length > 0;
            case 'insertItem': return nodes.some($isListItemNode);
            case 'deleteItem': return nodes.filter($isListItemNode).some(hasSiblings);
            case 'insertRow':  return rows.length > 0;
            case 'deleteRow':  return rows.some((row) => row.getPreviousSibling() !== null);
            case 'insertCell': return nodes.some($isTableCellNode);
            case 'deleteCell': return nodes.filter($isTableCellNode).some(hasSiblings);
            case 'insertQuoteBlock': return nodes.some($isMarkdownQuoteNode);
            case 'deleteQuoteBlock': return nodes.filter($isMarkdownQuoteNode).some((quote) => quote.getChildrenSize() > 1);
            default:           return false;
        }
    });
}

/**
 * Makes one random edit of the kind, inside an update.
 *
 * @param kind - The kind of edit, one that applies.
 * @param random - The case's random stream.
 * @param word - The word the edit writes, unique to the edit.
 * @returns What the edit did, for the failure message.
 */
function $edit(kind: EditKind, random: () => number, word: string): string {
    const nodes = $dfs().map(({ node }) => node);
    const items = nodes.filter($isListItemNode);
    const rows = nodes.filter($isTableRowNode);
    const cells = nodes.filter($isTableCellNode);
    const hasSiblings = (node: LexicalNode): boolean => (node.getParent()?.getChildrenSize() ?? 0) > 1;

    if (kind === 'insertQuoteBlock') {
        const quote = pick(random, nodes.filter($isMarkdownQuoteNode));
        const after = pick(random, quote.getChildren());

        after.insertAfter($createParagraphNode().append($createTextNode(word)));

        return `inserted a paragraph after '${after.getTextContent().slice(0, 20)}' in a quote`;
    }

    if (kind === 'deleteQuoteBlock') {
        const quote = pick(random, nodes.filter($isMarkdownQuoteNode).filter((candidate) => candidate.getChildrenSize() > 1));
        const block = pick(random, quote.getChildren());

        block.remove();

        return `deleted the block '${block.getTextContent().slice(0, 20)}' of a quote`;
    }

    if (kind === 'appendText') {
        const text = pick(random, $editableTextNodes());
        const done = `appended '${word}' to '${text.getTextContent()}'`;

        text.setTextContent(`${text.getTextContent()} ${word}`);

        return done;
    }

    if (kind === 'insertItem') {
        const item = pick(random, items);

        item.insertAfter($createListItemNode().append($createMarkdownListItemTextNode().append($createTextNode(word))));

        return `inserted an item after '${item.getTextContent().slice(0, 20)}'`;
    }

    if (kind === 'deleteItem') {
        const item = pick(random, items.filter(hasSiblings));

        item.remove();

        return `deleted the item '${item.getTextContent().slice(0, 20)}'`;
    }

    if (kind === 'insertRow') {
        const row = pick(random, rows);

        row.insertAfter($createTableRowNode().append(...Array.from({ length: row.getChildrenSize() }, () => cellWith(word, false))));

        return `inserted a row after '${row.getTextContent().slice(0, 20)}'`;
    }

    if (kind === 'deleteRow') {
        const row = pick(random, rows.filter((candidate) => candidate.getPreviousSibling() !== null));

        row.remove();

        return `deleted the row '${row.getTextContent().slice(0, 20)}'`;
    }

    if (kind === 'insertCell') {
        const cell = pick(random, cells);
        const isHeader = cell.getParent()?.getPreviousSibling() === null;

        cell.insertAfter(cellWith(word, isHeader));

        return `inserted a cell after '${cell.getTextContent().slice(0, 20)}'`;
    }

    const cell = pick(random, cells.filter(hasSiblings));

    cell.remove();

    return `deleted the cell '${cell.getTextContent().slice(0, 20)}'`;
}

/**
 * Makes one random edit as one discrete update.
 *
 * @param editor - The Markdown editor.
 * @param random - The case's random stream.
 * @param step - The edit's number, which makes the word it writes unique.
 * @returns What the edit did, for the failure message.
 */
function editOnce(editor: MarkdownEditor, random: () => number, step: number): string {
    let done = 'nothing';

    lexicalOf(editor).update(() => {
        const applicable = $applicableEdits();

        if (applicable.length > 0) {
            done = $edit(pick(random, applicable), random, `fuzz${step}`);
        }
    }, { discrete: true });

    return done;
}

/**
 * Tells whether a case lists a harness check as a known divergence, so the fuzz check that rests on it is skipped:
 * a random edit may or may not reach the divergent block, so it cannot be asserted to fail as the harness does.
 *
 * @param testCase - The case.
 * @param check - The harness check the fuzz check rests on.
 * @returns `true` when the case lists it.
 */
function knownDivergence(testCase: CorpusCase, check: HarnessCheck): boolean {
    return testCase.known?.[check] !== undefined;
}

/**
 * Loads a case, checks it saves as loaded, makes one random edit sequence and checks the save: it loads again to the
 * same model, saves to itself, reads in the viewer as the standard form of the same document does, and the editor
 * reads the definitions the viewer reads off it.
 *
 * @param testCase - The case.
 * @param random - The case's random stream.
 */
function fuzzSequence(testCase: CorpusCase, random: () => number): void {
    const { editor, saved: unedited } = loadAndSave(testCase.source);
    const edits = 1 + Math.floor(random() * MAX_EDITS_PER_SEQUENCE);
    const done = Array.from({ length: edits }, (_, step) => editOnce(editor, random, step));
    const saved = editor.getValue();
    const reloaded = loadAndSave(saved);
    const context = `${testCase.name} after ${done.join(', ')}:\n${saved}`;
    const surfaceKnown = (['edits', 'surface', 'parity'] as const).some((check) => knownDivergence(testCase, check));

    try {
        if (!knownDivergence(testCase, 'verbatim')) {
            expect(unedited, testCase.name).toBe(testCase.source.replace(/\r\n?/g, '\n'));
        }

        if (!surfaceKnown) {
            expect(editorSurfaceModel(reloaded.editor), context).toEqual(editorSurfaceModel(editor));
        }

        if (!knownDivergence(testCase, 'idempotence')) {
            expect(reloaded.saved, context).toBe(saved);
        }

        if (!knownDivergence(testCase, 'canonical')) {
            expect(viewerModel(saved), context).toEqual(viewerModel(canonicalSave(editor)));
        }

        if (!knownDivergence(testCase, 'definitions')) {
            const own = editorDefinitions(editor);

            expect(own, context).toEqual(viewerDefinitions(saved, own));
        }
    } finally {
        editor.dispose();
        reloaded.editor.dispose();
    }
}

describe('nested edit fuzz over the corpus and the nested documents', () => {
    it.each(CASES.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
        const random = randomStream(seedOf(testCase.name));

        for (let sequence = 0; sequence < SEQUENCES_PER_CASE; sequence++) {
            fuzzSequence(testCase, random);
        }
    });
});

/** The source-mode commands the fuzz runs, each a call of the editor's public method. */
const SOURCE_COMMANDS: ReadonlyArray<readonly [name: string, run: (editor: MarkdownEditor) => unknown]> = [
    ['unordered list', (editor) => editor.toggleUnorderedList()],
    ['ordered list', (editor) => editor.toggleOrderedList()],
    ['paragraph', (editor) => editor.setBlockType('paragraph')],
    ['heading', (editor) => editor.setBlockType('h2')],
    ['quote', (editor) => editor.setBlockType('quote')],
    ['code', (editor) => editor.setBlockType('code')],
    ['bold', (editor) => editor.toggleBold()],
    ['italic', (editor) => editor.toggleItalic()],
    ['underline', (editor) => editor.toggleUnderline()],
    ['inline code', (editor) => editor.toggleInlineCode()],
    ['link', (editor) => editor.toggleLink('https://example.com/x')],
    ['clear formatting', (editor) => editor.clearFormatting()],
];

/** Source-mode command sequences per case: each is a command at the middle of a random non-blank line. */
const SOURCE_SEQUENCES_PER_CASE = 4;

/**
 * The middle of each non-blank line of a source, where the fuzz puts the caret.
 *
 * @param source - The document.
 * @returns The offsets.
 */
function caretsOf(source: string): number[] {
    const offsets: number[] = [];
    let start = 0;

    for (const line of source.split('\n')) {
        if (line.trim() !== '') {
            offsets.push(start + Math.floor(line.length / 2));
        }

        start += line.length + 1;
    }

    return offsets;
}

/**
 * Runs a random source-mode command at a random caret and checks the text it leaves: loaded again it saves to itself,
 * and the viewer reads it as it reads the standard form of the loaded document.
 *
 * @param testCase - The case.
 * @param random - The case's random stream.
 */
function sourceCommandSequence(testCase: CorpusCase, random: () => number): void {
    const source = testCase.source.replace(/\r\n?/g, '\n');
    const carets = caretsOf(source);
    const [name, run] = pick(random, SOURCE_COMMANDS);
    const at = carets.length === 0 ? 0 : pick(random, carets);
    const editor = new MarkdownEditor(source, { mode: 'source' });
    const code = (editor as unknown as { _codeEditor: { getSelection: () => unknown } })._codeEditor;

    vi.spyOn(code, 'getSelection').mockReturnValue({ characterCount: 0, lineCount: 1, from: at, to: at });
    run(editor);

    const text = editor.getValue();
    const reloaded = loadAndSave(text);
    const context = `${testCase.name} after '${name}' at ${at}:\n${text}`;

    vi.restoreAllMocks();

    try {
        if (!knownDivergence(testCase, 'idempotence')) {
            expect(reloaded.saved, context).toBe(text);
        }

        if (!knownDivergence(testCase, 'canonical')) {
            expect(viewerModel(text), context).toEqual(viewerModel(canonicalSave(reloaded.editor)));
        }
    } finally {
        editor.dispose();
        reloaded.editor.dispose();
    }
}

describe('source-mode command fuzz over the corpus and the nested documents', () => {
    it.each(CASES.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
        const random = randomStream(seedOf(`source ${testCase.name}`));

        for (let sequence = 0; sequence < SOURCE_SEQUENCES_PER_CASE; sequence++) {
            sourceCommandSequence(testCase, random);
        }
    });
});
