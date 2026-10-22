// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $copyNode, $createParagraphNode, $createTextNode, $createRangeSelection, $getRoot, $getSelection, $isTextNode, $setSelection, CONTROLLED_TEXT_INSERTION_COMMAND, ElementNode,
    UNDO_COMMAND,
} from 'lexical';
import type { LexicalEditor } from 'lexical';
import { $generateJSONFromSelectedNodes, $generateNodesFromSerializedNodes, $insertGeneratedNodes } from '@lexical/clipboard';
import { $dfs } from '@lexical/utils';
import { lexMarkdown } from '~/component/display/markdownExtensions';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $createReferenceLinkNode } from '~/component/editor/markdownReferenceLinkNode';
import {
    $listReadsLoose, $rawBlockWritesAsParagraph, $serializeBlock, $serializeInlineNodes, $serializeRestOfBlock,
} from '~/component/editor/markdownSerializer';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

// Each mock wraps one function in a spy that still does its work, so a test can count how often an edit calls it;
// every other test sees the modules unchanged.
vi.mock('@lexical/utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@lexical/utils')>();

    return { ...actual, $dfs: vi.fn(actual.$dfs) };
});

vi.mock('lexical', async (importOriginal) => {
    const actual = await importOriginal<typeof import('lexical')>();

    return { ...actual, $copyNode: vi.fn(actual.$copyNode) };
});

vi.mock('~/component/display/markdownExtensions.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~/component/display/markdownExtensions.js')>();

    return { ...actual, lexMarkdown: vi.fn(actual.lexMarkdown) };
});

vi.mock('~/component/editor/markdownSerializer.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~/component/editor/markdownSerializer.js')>();

    return { ...actual, $listReadsLoose: vi.fn(actual.$listReadsLoose), $rawBlockWritesAsParagraph: vi.fn(actual.$rawBlockWritesAsParagraph) };
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

function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

function load(source: string): MarkdownEditor {
    const editor = new MarkdownEditor();

    editor.setValue(source);

    return editor;
}

/** Selects from `offset` in the document's first text to `offset` in its last one; the whole of both when `offset` is `null`. */
function selectAll(editor: MarkdownEditor, offset: number | null = 1): void {
    lexicalOf(editor).update(() => {
        const texts = $getRoot().getAllTextNodes();
        const last = texts[texts.length - 1]!;
        const selection = $createRangeSelection();

        selection.anchor.set(texts[0]!.getKey(), offset ?? 0, 'text');
        selection.focus.set(last.getKey(), offset ?? last.getTextContentSize(), 'text');
        $setSelection(selection);
    }, { discrete: true });
}

/** Puts the caret after the first character of the text node reading `text`. */
function caretIn(editor: MarkdownEditor, text: string): void {
    lexicalOf(editor).update(() => {
        const node = $getRoot().getAllTextNodes().find((candidate) => candidate.getTextContent() === text)!;

        node.select(1, 1);
    }, { discrete: true });
}

/** Pastes the whole of `source`, loaded in an editor of its own, at the selection. */
function paste(editor: MarkdownEditor, source: string): void {
    const origin = load(source);
    const originLexical = lexicalOf(origin);

    selectAll(origin, null);

    const nodes = originLexical.read(() => $generateJSONFromSelectedNodes(originLexical, $getSelection()).nodes);
    const lexical = lexicalOf(editor);

    origin.dispose();
    lexical.update(() => {
        $insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(nodes), $getSelection()!);
    }, { discrete: true });
}

const repeat = (count: number, each: (index: number) => string, between: string): string => Array.from({ length: count }, (_, index) => each(index)).join(between);
const paragraphs = (count: number): string => repeat(count, (index) => `para${index}`, '\n\n');
const linked = (count: number): string => repeat(count, (index) => `para${index} [l${index}](/u${index})`, '\n\n');
const rawBlocks = (count: number): string => repeat(count, (index) => `<div>raw${index}</div>`, '\n\n');
const rawAndText = (count: number): string => repeat(count, (index) => `<div>raw${index}</div>\n\ntext${index}`, '\n\n');
const references = (count: number): string => repeat(count, (index) => `text${index} [l${index}][r${index}] end\n\n[r${index}]: /u${index}`, '\n\n');
const tight = (count: number): string => repeat(count, (index) => `- item${index}`, '\n');
const twoBlocks = (count: number): string => repeat(count, (index) => `- item${index}\n\n  more${index}`, '\n\n');
const fences = (count: number): string => repeat(count, (index) => `::: columns\nleft${index}\n|||\nright${index}\n:::\n\nsep${index}`, '\n\n');

type Edit = (count: number) => void;

/** The walks of the whole document (`$dfs()` with no start node) an edit makes. */
function documentWalks(edit: () => void): number {
    const walk = vi.mocked($dfs);

    walk.mockClear();
    edit();

    return walk.mock.calls.filter((call) => call.length === 0 || call[0] === undefined).length;
}

describe('large documents: the rules read the document once, not once for each block', () => {
    /**
     * The most walks of the whole document one row may make, whatever the
     * document's length. Every save makes one (`$readDefinitions`), and a row
     * makes a save for each update it runs, the loads and selections of its
     * set-up among them (measured: 2 to 16). Before the rules read a block's
     * definitions by what the block holds, they made one more walk for every
     * block they tidied or checked: 43 to 4,847 for the 40 blocks used here.
     */
    const DOCUMENT_WALKS_AT_MOST = 20;

    const ROWS: Array<[name: string, edit: Edit]> = [
        ['D1: a paste of paragraphs into an empty document', (count) => {
            const editor = load('');

            lexicalOf(editor).update(() => { $getRoot().selectStart(); }, { discrete: true });
            paste(editor, paragraphs(count));
            editor.getValue();
        }],
        ['D2: a paste of paragraphs holding links', (count) => {
            const editor = load('');

            lexicalOf(editor).update(() => { $getRoot().selectStart(); }, { discrete: true });
            paste(editor, linked(count));
            editor.getValue();
        }],
        ['D3: bold over every paragraph', (count) => {
            const editor = load(paragraphs(count));

            selectAll(editor);
            editor.toggleBold();
            editor.getValue();
        }],
        ['D4: every paragraph made a code block', (count) => {
            const editor = load(paragraphs(count));

            selectAll(editor);
            editor.setBlockType('code');
            editor.getValue();
        }],
        ['D5: a load of raw blocks', (count) => { load(rawBlocks(count)).getValue(); }],
        ['D6: a load of raw blocks and paragraphs', (count) => { load(rawAndText(count)).getValue(); }],
        ['D7: a load of reference links and their definitions', (count) => { load(references(count)).getValue(); }],
        ['D8: a letter typed in a document of reference links and definitions', (count) => {
            const editor = load(references(count));

            caretIn(editor, 'text0 ');
            vi.mocked($dfs).mockClear();
            lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'z');
            editor.getValue();
        }],
    ];

    for (const [name, edit] of ROWS) {
        it(`${name} walks the document a fixed number of times`, () => {
            const short = documentWalks(() => edit(20));
            const long = documentWalks(() => edit(40));

            expect(long).toBe(short);
            expect(long).toBeLessThanOrEqual(DOCUMENT_WALKS_AT_MOST);
        });
    }

    /**
     * The most times a raw block may be asked whether it is written as a
     * paragraph, per raw block of the document, in one load or edit: once in
     * the first check of its siblings, once when its own text is new, once
     * for the block after it, and once in each of the passes the document's
     * own rule makes (measured: 4 to 6). Before a changed block checked only
     * the raw blocks it can change, each was asked once for every changed
     * block: 40 times and more in the documents used here.
     */
    const CHECKS_PER_RAW_BLOCK_AT_MOST = 8;

    it.each([
        ['R1: a load of raw blocks', rawBlocks],
        ['R2: a load of raw blocks and paragraphs', rawAndText],
        ['R3: a load of reference links and their definitions', references],
    ] as const)('%s asks each raw block a fixed number of times', (_name, source) => {
        const asked = vi.mocked($rawBlockWritesAsParagraph);

        for (const count of [40, 80]) {
            asked.mockClear();
            load(source(count)).getValue();

            expect(asked.mock.calls.length / count).toBeLessThanOrEqual(CHECKS_PER_RAW_BLOCK_AT_MOST);
        }
    });
});

describe('large documents: a copied block is read under the definitions only when the document holds a reference', () => {
    it('D9: a copy of a block that holds a reference link is written inline when no other reference stands in the document', () => {
        const editor = load('plain\n\n[r]: /u');

        lexicalOf(editor).update(() => {
            const paragraph = $createParagraphNode();
            const link = $createReferenceLinkNode('/u', null, { label: 'r', form: 'full', definitionUrl: '/u', definitionTitle: null, importedContent: 'a' });

            link.append($createTextNode('a'));
            paragraph.append(link);

            // The copy stands outside the document, whose one definition no reference link uses: the link is written with its URL.
            expect($serializeBlock(paragraph)).toBe('[a](/u)');
            expect($serializeInlineNodes([link])).toBe('[a](/u)');
            expect($serializeRestOfBlock(paragraph, [link], '')).toBe('[a](/u)');
        }, { discrete: true });
    });
});

describe('large documents: a run of list items is lifted and joined without a pass over the list for each item', () => {
    /** How many times `count` items make an edit call a spied function. */
    function calls(spy: { mockClear: () => void; mock: { calls: unknown[] } }, prepare: () => MarkdownEditor, edit: (editor: MarkdownEditor) => void): number {
        const editor = prepare();

        spy.mockClear();
        edit(editor);
        editor.getValue();

        return spy.mock.calls.length;
    }

    const all = (source: string) => (): MarkdownEditor => {
        const editor = load(source);

        selectAll(editor);

        return editor;
    };

    /**
     * The most lists one edit may copy to hold the rest of a list it splits,
     * whatever the list's length: one for the run it lifts (measured: 1).
     * Before, each lifted item made one, and moved every later item into it.
     */
    const REST_LISTS_AT_MOST = 2;

    it('L1: a block type set on every item of a list copies the list a fixed number of times', () => {
        const copy = vi.mocked($copyNode);
        const short = calls(copy, all(tight(20)), (editor) => { editor.setBlockType('h2'); });
        const long = calls(copy, all(tight(40)), (editor) => { editor.setBlockType('h2'); });

        expect(long).toBe(short);
        expect(long).toBeLessThanOrEqual(REST_LISTS_AT_MOST);
    });

    it('L7: a block type set on every block of a list whose items each hold a paragraph copies the list a fixed number of times', () => {
        const copy = vi.mocked($copyNode);
        const short = calls(copy, all(twoBlocks(20)), (editor) => { editor.setBlockType('h2'); });
        const long = calls(copy, all(twoBlocks(40)), (editor) => { editor.setBlockType('h2'); });

        expect(long).toBe(short);
        expect(long).toBeLessThanOrEqual(REST_LISTS_AT_MOST);
    });

    /**
     * The most siblings an edit may walk to count a node's place among them
     * (`getIndexWithinParent`, which walks from the first sibling), for each
     * item of the list (measured: 0 to 1). Before, every lifted item was
     * counted in its list, and its list in the document: 20 siblings an item
     * and more for the 40 items used here.
     */
    const SIBLINGS_WALKED_PER_ITEM_AT_MOST = 2;

    it.each([
        ['L2: the numbered toggle over a whole bulleted list', tight, (editor: MarkdownEditor): void => { editor.toggleOrderedList(); }],
        ['L3: the bulleted toggle off over a whole bulleted list', tight, (editor: MarkdownEditor): void => { editor.toggleUnorderedList(); }],
        ['L4: a block type set on every item of a list', tight, (editor: MarkdownEditor): void => { editor.setBlockType('h2'); }],
        ['L5: the bulleted toggle over a list whose items each hold a paragraph', twoBlocks, (editor: MarkdownEditor): void => { editor.toggleUnorderedList(); }],
    ] as const)('%s walks a fixed number of siblings for each item', (_name, source, edit) => {
        const counted = vi.spyOn(ElementNode.prototype, 'getIndexWithinParent');

        for (const count of [40, 80]) {
            calls(counted, all(source(count)), edit);

            // The place a call returns is the number of siblings it walked.
            const walked = counted.mock.results.reduce((sum, result) => sum + Math.max(0, Number(result.value)), 0);

            expect(walked / count).toBeLessThanOrEqual(SIBLINGS_WALKED_PER_ITEM_AT_MOST);
        }

        counted.mockRestore();
    });

    /**
     * The most whole-list looseness reads the bulleted toggle may make over
     * a list whose items each hold a paragraph, whatever its length
     * (measured: 3). Before, the toggle left a list for each item, and the
     * list rule joined them one at a time, reading the list it had grown to
     * each time.
     */
    const WHOLE_READS_AT_MOST = 10;

    it('L6: the bulleted toggle over a list whose items each hold a paragraph reads a whole list a fixed number of times', () => {
        const read = vi.mocked($listReadsLoose);
        const short = calls(read, all(twoBlocks(20)), (editor) => { editor.toggleUnorderedList(); });
        const long = calls(read, all(twoBlocks(40)), (editor) => { editor.toggleUnorderedList(); });

        expect(long).toBe(short);
        expect(long).toBeLessThanOrEqual(WHOLE_READS_AT_MOST);
    });
});

describe('large documents: a save lexes a block that closes its own fence alone', () => {
    /**
     * The most characters one save may hand to the block lexer for each
     * character of the document it writes, whatever the document's length
     * (measured: 0.8). Before, the save lexed every `:::` block
     * together with everything written after it: 22 and 42 characters for each
     * character of the 40 and the 80 fences used here.
     */
    const LEXED_FOR_EACH_CHARACTER_AT_MOST = 4;

    it('F1: a save of a document of `:::` blocks lexes text in proportion to the document', () => {
        const lex = vi.mocked(lexMarkdown);
        const lexedForEachCharacter = (count: number): number => {
            const editor = load(fences(count));

            lex.mockClear();

            const saved = editor.getValue();
            const lexed = lex.mock.calls.reduce((sum, call) => sum + call[0].length, 0);

            return lexed / saved.length;
        };

        expect(lexedForEachCharacter(40)).toBeLessThanOrEqual(LEXED_FOR_EACH_CHARACTER_AT_MOST);
        expect(lexedForEachCharacter(80)).toBeLessThanOrEqual(LEXED_FOR_EACH_CHARACTER_AT_MOST);
    });
});

describe('large documents: what the edits leave', () => {
    it('S1: a block type set on every item of a list gives one block for each item, and one undo gives the list back', () => {
        const editor = load(tight(6));
        const before = editor.getValue();

        selectAll(editor);
        editor.setBlockType('h2');

        expect(editor.getValue()).toBe(repeat(6, (index) => `## item${index}`, '\n\n'));

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(before);
    });

    it('S2: a block type set on the first items of a list leaves the rest one list', () => {
        const editor = load(tight(5));

        lexicalOf(editor).update(() => {
            const texts = $getRoot().getAllTextNodes().filter($isTextNode);
            const selection = $createRangeSelection();

            selection.anchor.set(texts[0]!.getKey(), 1, 'text');
            selection.focus.set(texts[2]!.getKey(), 1, 'text');
            $setSelection(selection);
        }, { discrete: true });
        editor.setBlockType('h2');

        expect(editor.getValue()).toBe('## item0\n\n## item1\n\n## item2\n\n- item3\n- item4');
    });

    it('S3: the bulleted toggle over a list whose items each hold a paragraph makes each paragraph an item of the same list', () => {
        const editor = load(twoBlocks(3));

        selectAll(editor);
        editor.toggleUnorderedList();

        expect(editor.getValue()).toBe('- item0\n\n- more0\n\n- item1\n\n- more1\n\n- item2\n\n- more2');
        expect(load(editor.getValue()).getValue()).toBe(editor.getValue());
    });

    it('S4: text typed after a raw block that runs on shows that block as the paragraph it is saved as', () => {
        const editor = load('<!-- open');

        lexicalOf(editor).update(() => {
            $getRoot().append($createParagraphNode());
            $getRoot().selectEnd();
        }, { discrete: true });

        expect(editor.getValue()).toBe('<!-- open');

        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');

        expect(editor.getValue()).toBe('\\<!-- open\n\nx');
        expect(load(editor.getValue()).getValue()).toBe(editor.getValue());
    });

    it('S5: paragraphs pasted between raw blocks that run on show each of those blocks as a paragraph', () => {
        const editor = load('p0');

        caretIn(editor, 'p0');
        paste(editor, '<!-- a\n\nx0\n\n<pre>\n\nx1');

        const saved = editor.getValue();

        expect(load(saved).getValue()).toBe(saved);
        expect(saved).toContain('\\<!-- a');
    });

    it('S6: an unclosed fence opener is written escaped once a block after it holds the line that would close it', () => {
        const editor = load('::: note\n\np0\n\np1');

        expect(editor.getValue()).toBe('::: note\n\np0\n\np1');

        caretIn(editor, 'p0');
        paste(editor, 'x0\n\n<div>\n:::\n</div>\n\nx1');

        expect(editor.getValue()).toBe('\\::: note\n\npx0\n\n<div>\n:::\n</div>\n\nx10\n\np1');
        expect(load(editor.getValue()).getValue()).toBe(editor.getValue());
    });

    it('S7: a fence that closes itself stays as written when a block after it holds a closing line', () => {
        const editor = load('::: columns\nl0\n|||\nr0\n:::\n\np0');

        caretIn(editor, 'p0');
        paste(editor, 'x0\n\n<div>\n:::\n</div>\n\nx1');

        expect(editor.getValue()).toBe('::: columns\nl0\n|||\nr0\n:::\n\npx0\n\n<div>\n:::\n</div>\n\nx10');
        expect(load(editor.getValue()).getValue()).toBe(editor.getValue());
    });

    it('S8: a toggle over two runs between lists keeps a loose list after the second run loose, and the joined list with it', () => {
        const editor = load('* a\n\np\n\n* b\n\nq\n\n* c\n\n* d');

        lexicalOf(editor).update(() => {
            const texts = $getRoot().getAllTextNodes().filter($isTextNode);
            const selection = $createRangeSelection();

            selection.anchor.set(texts[1]!.getKey(), 0, 'text');
            selection.focus.set(texts[3]!.getKey(), 1, 'text');
            $setSelection(selection);
        }, { discrete: true });
        editor.toggleUnorderedList();

        expect(editor.getValue()).toBe('* a\n\n* p\n\n* b\n\n* q\n\n* c\n\n* d');
        expect(load(editor.getValue()).getValue()).toBe(editor.getValue());
    });

    it('S9: a toggle over one run before a loose list makes the joined list loose', () => {
        const editor = load('* a\n\nq\n\n* c\n\n* d');

        caretIn(editor, 'q');
        editor.toggleUnorderedList();

        expect(editor.getValue()).toBe('* a\n\n* q\n\n* c\n\n* d');
        expect(load(editor.getValue()).getValue()).toBe(editor.getValue());
    });
});
