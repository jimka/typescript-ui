import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { $createLineBreakNode, $createParagraphNode, $createTextNode, $getRoot, $isElementNode } from 'lexical';
import type { ElementNode, LexicalEditor, LexicalNode } from 'lexical';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellHeaderStates } from '@lexical/table';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $createMarkdownImageNode } from '~/component/editor/markdownImageNode';
import { $createMarkdownBlockNode, $createMarkdownColumnNode } from '~/component/editor/markdownBlockNode';
import { $createMarkdownListItemTextNode } from '~/component/editor/markdownListItemNode';
import { $createMarkdownRawBlockNode } from '~/component/editor/markdownSourceNodes';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { canonicalSave } from './harness';
import { editorSurfaceModel } from './viewModel';

// A deterministic fuzz of plain text full of Markdown punctuation, in the
// blocks that hold inline text (paragraphs, headings, quotes, lists, tables
// with cells of one or two paragraphs, and columns): the standard-form
// save of each document
// must load back to what the editor showed, and save again to itself. The
// save escapes a character only where it would otherwise read as something
// else, so a rule that leaves out a needed escape shows here as a document
// that reloads differently.

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** The fixed seed of the document stream; changing it explores other documents. */
const FUZZ_SEED = 0xe5c;

/** Documents per run: about a second of the suite, and enough to reach every line start in every block kind. */
const DOCUMENTS = 300;

/** The ASCII punctuation a word is drawn from: every character a backslash escapes in CommonMark that text holds. */
const PUNCTUATION = '*_~`[]()!<>#-+=|:.{}\\&@/\'"$%^?,;';

/** Line starts and words that open, or nearly open, a construct. */
const OPENERS = [
    '---', '===', '- ', '* ', '+ ', '1. ', '2) ', '# ', '###### x', '#tag', '> ', '|||', ':::', ':::x', '```', '~~~', '***', '___',
    '_ _ _', '| a |', '--- | ---', '|-|', ':-:', '[a]: /u', '[ ] ', '[x] ', '<div>', '--', '-', '=', '+', '1.5', '10.', '~', '`',
    '__init__', '*a*', '[a]', '[a](b)', '[a]{color=red}', '![x](y)', 'https://e.com', 'www.e.com', 'a@b.co', '&amp;', '\\', ':',
    '|', '>', '#', '    x',
];

/**
 * A seeded pseudo-random stream (mulberry32), as `markdown-edit-fuzz.test.ts` uses; its constants are mulberry32's own.
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
 * Picks one entry of a list.
 *
 * @param random - The stream.
 * @param items - The list.
 * @returns The entry.
 */
function pick<T>(random: () => number, items: readonly T[]): T {
    return items[Math.floor(random() * items.length)]!;
}

/**
 * One word: letters, a run of punctuation, or an opener.
 *
 * @param random - The stream.
 * @returns The word.
 */
function word(random: () => number): string {
    const roll = random();

    if (roll < 0.45) {
        return 'abcdefghij'.slice(0, 1 + Math.floor(random() * 6));
    }

    if (roll < 0.8) {
        return Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(random, [...PUNCTUATION])).join('');
    }

    return pick(random, OPENERS);
}

/**
 * One line of text, half of them opening with an opener.
 *
 * @param random - The stream.
 * @returns The line.
 */
function line(random: () => number): string {
    const words = Array.from({ length: 1 + Math.floor(random() * 4) }, () => word(random));

    return (random() < 0.5 ? pick(random, OPENERS) : '') + words.join(random() < 0.7 ? ' ' : '');
}

/**
 * A block's text: one to three lines, joined by line breaks unless the block holds one line.
 *
 * @param random - The stream.
 * @param oneLine - Whether the block holds a single line.
 * @returns Its text nodes and line breaks.
 */
function text(random: () => number, oneLine: boolean): LexicalNode[] {
    const lines = oneLine ? 1 : 1 + Math.floor(random() * 3);

    return Array.from({ length: lines }, (_, index) => {
        const nodes = withEmphasis ? emphasisLine(random) : [$createTextNode(line(random))];
        const withImage = withImages && random() < 0.7;

        if (withImage) {
            nodes.push(image(random));
        }

        return index === 0 ? nodes : [$createLineBreakNode(), ...nodes];
    }).flat();
}

/** Whether the documents hold images whose alt text and title hold Markdown punctuation (see {@link image}). */
let withImages = false;

/** Image sources: plain, ones a bare destination cannot hold, and one holding parentheses. */
const IMAGE_SOURCES = ['/i.png', '/a b.png', '/p(1).png', 'https://e.com/i.png?a=1&b=2', '/a<b>.png'];

/** Alt text openers that read as references or links once a definition names their label. */
const IMAGE_LABEL_ALTS = ['[a]', '[A]', 'x [b] y', '[a][b]', '[][a]', '[a]()', '![a]', '[x](u)', 'p\nq'];

/**
 * An image whose alt text is a line of words and openers, with a title half of the time.
 *
 * @param random - The stream.
 * @returns The image.
 */
function image(random: () => number): LexicalNode {
    const spec = { src: pick(random, IMAGE_SOURCES), alt: (random() < 0.5 ? pick(random, IMAGE_LABEL_ALTS) : '') + line(random), width: random() < 0.3 ? 10 : null, height: null };

    return $createMarkdownImageNode(spec, random() < 0.5 ? line(random) : null);
}

/** Whether the documents are loaded from Markdown holding images in the forms they were written in (see {@link keptImageDocument}). */
let withKeptImages = false;

/** Image forms as written, each naming the definitions of {@link KEPT_IMAGE_DEFINITIONS} where it names a label. */
const KEPT_IMAGE_FORMS = [
    '![a](/i.png)', '![a](/i.png "t")', "![a](</a b.png> 't')", '![a][r]', '![a][]', '![a]', '![a][r]{width=4}', '![a]{width=4}', '![A *b*][]',
];

/** The definitions the kept forms resolve against. */
const KEPT_IMAGE_DEFINITIONS = '[r]: /r.png "T"\n[a]: /a.png\n[a *b*]: /b.png';

/** Text typed right after a kept image: most of it opens something that could attach to the image. */
const KEPT_IMAGE_FOLLOWERS = ['{width=3}', '{x}', '{height=3} y', '(x)', '[l]', '[l](u)', ' z', '{a=1}(b)', ''];

/**
 * An editor loaded from paragraphs of images in the forms they were written in, with text typed right after
 * one of them: where a `{`, `(` or `[` could join the image.
 *
 * @param random - The stream.
 * @returns The editor.
 */
function keptImageDocument(random: () => number): MarkdownEditor {
    const editor = new MarkdownEditor();
    const paragraphs = Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
        const images = Array.from({ length: 1 + Math.floor(random() * 2) }, () => {
            const form = pick(random, KEPT_IMAGE_FORMS);
            const mark = random() < 0.3 ? pick(random, ['*', '**', '~~']) : '';

            return `${mark}${form}${mark}`;
        });

        return images.join(random() < 0.5 ? ' ' : ' and ');
    });

    editor.setValue(`${paragraphs.join('\n\n')}\n\n${KEPT_IMAGE_DEFINITIONS}`);
    lexicalOf(editor).update(() => {
        const first = $getRoot().getFirstChild();

        if ($isElementNode(first)) {
            first.append($createTextNode(pick(random, KEPT_IMAGE_FOLLOWERS)));
        }
    }, { discrete: true });

    return editor;
}

/** Whether the documents hold bold and struck text, and link reference definitions (see {@link emphasisLine}). */
let withEmphasis = false;

/** Texts that open or close a reference label, or look like a reference, between the emphasis of {@link emphasisLine}. */
const LABEL_TEXTS = ['[', ']', '[a]', '[A]', '[b', 'a]', '[x ', ' ]', '[a][', '(u)', '*', '_', '~', ' ', 'x'];

/**
 * One line of text and bold or struck words between brackets: what `marked` masks when a definition names the label.
 *
 * @param random - The stream.
 * @returns The line's text nodes.
 */
function emphasisLine(random: () => number): LexicalNode[] {
    return Array.from({ length: 2 + Math.floor(random() * 5) }, () => {
        const roll = random();

        if (roll < 0.25) {
            return $createTextNode('b').toggleFormat('bold');
        }

        if (roll < 0.35) {
            return $createTextNode('s').toggleFormat('strikethrough');
        }

        return $createTextNode(pick(random, LABEL_TEXTS));
    });
}

/**
 * Appends children to an element.
 *
 * @param element - The element.
 * @param children - Its children.
 * @returns `element`.
 */
function fill<T extends ElementNode>(element: T, children: LexicalNode[]): T {
    element.append(...children);

    return element;
}

/**
 * A list of one to three items, an item sometimes holding a paragraph or a nested list after its text.
 *
 * @param random - The stream.
 * @param depth - How deep the list is nested.
 * @returns The list.
 */
function list(random: () => number, depth: number): LexicalNode {
    const node = $createListNode(random() < 0.5 ? 'bullet' : 'number', 1);
    const items = 1 + Math.floor(random() * 3);

    for (let index = 0; index < items; index++) {
        const item = $createListItemNode().append(fill($createMarkdownListItemTextNode(), text(random, false)));
        const withParagraph = random() < 0.2;

        if (withParagraph) {
            item.append(fill($createParagraphNode(), text(random, false)));
        }

        const withNestedList = random() < 0.2;

        if (withNestedList && depth < 2) {
            item.append(list(random, depth + 1));
        }

        node.append(item);
    }

    return node;
}

/**
 * A two-by-two table, each cell holding one line, or two paragraphs of one line each.
 *
 * @param random - The stream.
 * @returns The table.
 */
function table(random: () => number): LexicalNode {
    const node = $createTableNode();

    for (let row = 0; row < 2; row++) {
        const cells = [0, 1].map(() => {
            const cell = $createTableCellNode(row === 0 ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS);
            const roll = random();

            const paragraphs = roll < 0.6 ? 2 : 1;

            return cell.append(...Array.from({ length: paragraphs }, () => fill($createParagraphNode(), text(random, true))));
        });

        node.append(fill($createTableRowNode(), cells));
    }

    return node;
}

/**
 * One block: a paragraph, heading, quote, list, table or, at the top level, a two-column fence.
 *
 * @param random - The stream.
 * @param nested - Whether the block stands in a column.
 * @returns The block.
 */
function block(random: () => number, nested: boolean): LexicalNode {
    const roll = random();

    if (roll < 0.4) {
        return fill($createParagraphNode(), text(random, false));
    }

    if (roll < 0.52) {
        return fill($createHeadingNode(pick(random, ['h1', 'h2', 'h3'] as const)), text(random, random() < 0.6));
    }

    if (roll < 0.62) {
        return fill($createQuoteNode(), text(random, false));
    }

    if (roll < 0.82) {
        return list(random, 0);
    }

    if (roll < 0.92 || nested) {
        return table(random);
    }

    return fill($createMarkdownBlockNode(), [0, 1].map(() => fill($createMarkdownColumnNode(), [block(random, true), block(random, true)])));
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
 * An editor holding one to three random blocks.
 *
 * @param random - The stream.
 * @returns The editor.
 */
function randomDocument(random: () => number): MarkdownEditor {
    if (withKeptImages) {
        return keptImageDocument(random);
    }

    const editor = new MarkdownEditor();

    editor.setValue('');
    lexicalOf(editor).update(() => {
        const root = $getRoot();

        root.clear();
        root.append(...Array.from({ length: 1 + Math.floor(random() * 3) }, () => block(random, false)));

        if ((withEmphasis || withImages) && random() < 0.7) {
            root.append($createMarkdownRawBlockNode(pick(random, ['[a]: /u', '[A]: /u', '[b]: /u', '[a]: /u\n[b]: /v'])));
        }
    }, { discrete: true });

    return editor;
}

describe('a save escapes only what would read otherwise, and reloads as shown', () => {
    // Vitest's default per-test timeout is 5s. Saving and loading the seeded documents took about 5s under load.
    const FUZZ_TIMEOUT_MS = 60_000;

    const runs: Array<[title: string, emphasis: boolean, seed: number]> = [
        [`${DOCUMENTS} seeded documents of text with Markdown punctuation`, false, FUZZ_SEED],
        [`${DOCUMENTS} seeded documents of bold and struck text between brackets, with link reference definitions`, true, FUZZ_SEED + 1],
    ];

    it(`${DOCUMENTS} seeded documents of images whose alt text and title hold Markdown punctuation, with link reference definitions, load back as shown and save again unchanged`, () => {
        withImages = true;

        try {
            checkDocuments(FUZZ_SEED + 2);
        } finally {
            withImages = false;
        }
    }, FUZZ_TIMEOUT_MS);

    it(`${DOCUMENTS} seeded documents of images kept in their written forms, with text typed right after them, load back as shown and save again unchanged`, () => {
        withKeptImages = true;

        try {
            checkDocuments(FUZZ_SEED + 3);
        } finally {
            withKeptImages = false;
        }
    }, FUZZ_TIMEOUT_MS);

    for (const [title, emphasis, seed] of runs) {
        it(`${title} load back as shown and save again unchanged`, () => {
            withEmphasis = emphasis;

            try {
                checkDocuments(seed);
            } finally {
                withEmphasis = false;
            }
        }, FUZZ_TIMEOUT_MS);
    }
});

/**
 * Saves seeded documents, loads each save, and expects what the editor held, and a second save the same.
 *
 * @param seed - The seed of the document stream.
 */
function checkDocuments(seed: number): void {
    const random = randomStream(seed);

    for (let index = 0; index < DOCUMENTS; index++) {
        const editor = randomDocument(random);
        const saved = canonicalSave(editor);
        const reloaded = new MarkdownEditor();

        reloaded.setValue(saved);

        expect(editorSurfaceModel(reloaded), `document ${index}: ${saved}`).toEqual(editorSurfaceModel(editor));
        expect(canonicalSave(reloaded), `document ${index}`).toBe(saved);

        reloaded.dispose();
        editor.dispose();
    }
}
