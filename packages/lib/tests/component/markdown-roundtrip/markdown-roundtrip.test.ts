import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { assertCheck, canonicalSave, checkTitle, editorDefinitions, loadAndSave, viewerDefinitions } from './harness';
import { blockOutline, editorSurfaceModel, linkTargets, viewerModel } from './viewModel';
import { CORPUS } from './corpus';
import { tabDocuments } from './tabDocuments';
import { expandPrefixTabs } from '~/component/display/markdownTabs';
import { DIVERGENCES } from './corpus/divergences';
import { ENTER_IN_CODE_CASES } from './corpus/enterInCode';
import { ENTER_INSIDE_HTML_CASES } from './corpus/enterInsideHtml';
import type { CorpusCase } from './corpus/types';
import type { Block } from './viewModel';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('harness assertions', () => {
    const plainCase: CorpusCase = { name: 'plain', source: 'x' };
    const knownCase: CorpusCase = { name: 'known', source: 'x', known: { parity: 'quoteBlocks' } };

    it('H1. passes an unlisted check whose values are equal', () => {
        expect(() => assertCheck(plainCase, 'parity', { a: 1 }, { a: 1 })).not.toThrow();
    });

    it('H2. fails an unlisted check whose values differ', () => {
        expect(() => assertCheck(plainCase, 'parity', { a: 1 }, { a: 2 })).toThrow();
    });

    it('H3. passes a listed check whose values differ, and names the divergence in its title', () => {
        expect(() => assertCheck(knownCase, 'parity', { a: 1 }, { a: 2 })).not.toThrow();
        expect(checkTitle(knownCase, 'parity')).toBe('parity (known divergence: quoteBlocks)');
        expect(checkTitle(knownCase, 'surface')).toBe('surface');
    });

    it('H4. fails a listed check that now holds, telling the reader to remove the entry', () => {
        expect(() => assertCheck(knownCase, 'parity', { a: 1 }, { a: 1 })).toThrow(/now holds.*quoteBlocks/);
    });
});

// One describe per corpus document. Load-and-save runs inside every check, so a
// throw in either fails the case; the expected value is always what the viewer
// shows, never what the current editor produces.
for (const testCase of CORPUS) {
    describe(testCase.name, () => {
        const links = testCase.links;

        if (links !== undefined) {
            it('viewer reads the declared links', () => {
                expect(linkTargets(viewerModel(testCase.source))).toEqual(links);
            });
        }

        const blocks = testCase.blocks;

        if (blocks !== undefined) {
            it('viewer reads the declared blocks', () => {
                expect(blockOutline(viewerModel(testCase.source).blocks)).toBe(blocks);
            });
        }

        it(checkTitle(testCase, 'parity'), () => {
            const { saved } = loadAndSave(testCase.source);

            assertCheck(testCase, 'parity', viewerModel(saved), viewerModel(testCase.source));
        });

        it(checkTitle(testCase, 'idempotence'), () => {
            const { saved } = loadAndSave(testCase.source);

            assertCheck(testCase, 'idempotence', loadAndSave(saved).saved, saved);
        });

        it(checkTitle(testCase, 'surface'), () => {
            const { editor } = loadAndSave(testCase.source);

            assertCheck(testCase, 'surface', editorSurfaceModel(editor), viewerModel(testCase.source).blocks);
        });

        it(checkTitle(testCase, 'verbatim'), () => {
            const { saved } = loadAndSave(testCase.source);

            assertCheck(testCase, 'verbatim', saved, testCase.source.replace(/\r\n?/g, '\n'));
        });

        it(checkTitle(testCase, 'canonical'), () => {
            const { editor } = loadAndSave(testCase.source);

            assertCheck(testCase, 'canonical', viewerModel(canonicalSave(editor)), viewerModel(testCase.source));
        });

        it(checkTitle(testCase, 'canonicalIdempotence'), () => {
            const first = canonicalSave(loadAndSave(testCase.source).editor);
            const second = loadAndSave(first).editor;

            assertCheck(testCase, 'canonicalIdempotence', canonicalSave(second), first);
        });

        it(checkTitle(testCase, 'definitions'), () => {
            const { editor, saved } = loadAndSave(testCase.source);
            const own = editorDefinitions(editor);

            assertCheck(testCase, 'definitions', own, viewerDefinitions(saved, own));
        });
    });
}

/**
 * Lists the blocks of a document that hold no blocks themselves, in document order, each with the blockquote or list
 * item that holds it, written as a path: `''` at the top level, `'/0'` in a quote that is the document's first block,
 * `'/0.1/2'` in a quote that is the third block of the second item of a list that is the first block.
 *
 * @param blocks - The blocks of the document, or of one quote or list item.
 * @param container - The path of the quote or list item that holds `blocks`.
 * @returns Each such block's kind, the path of what holds it, and a code block's text.
 */
function leavesWithContainer(blocks: readonly Block[], container: string = ''): { kind: Block['kind']; container: string; text?: string }[] {
    return blocks.flatMap((block, index) => {
        if (block.kind === 'quote') {
            return leavesWithContainer(block.blocks, `${container}/${index}`);
        }

        if (block.kind === 'list') {
            return block.items.flatMap((item, itemIndex) => leavesWithContainer(item, `${container}/${index}.${itemIndex}`));
        }

        return [block.kind === 'code' ? { kind: block.kind, container, text: block.text } : { kind: block.kind, container }];
    });
}

describe('what Enter leaves inside HTML stays in its blockquote or list item', () => {
    // Each of these documents is one blockquote or one list, and its HTML
    // starts in the innermost quote or item of its first HTML line. A new
    // line that left one of them would show as a block after it: `> <div>`,
    // an empty line and `> x` are two quotes, and a close tag one level out
    // of a nested item is a block of the outer item.
    it.each(ENTER_INSIDE_HTML_CASES.map((testCase) => [testCase.name, testCase.source] as const))('%s', (name, source) => {
        const { blocks } = viewerModel(source);
        const leaves     = leavesWithContainer(blocks);
        // The viewer shows an HTML block as a raw block. A document with
        // none holds inline tags only, in its one paragraph.
        const firstHtml  = Math.max(leaves.findIndex((leaf) => leaf.kind === 'raw'), 0);
        const containers = new Set(leaves.slice(firstHtml).map((leaf) => leaf.container));

        expect(blocks.map((block) => block.kind)).toEqual([source.startsWith('>') ? 'quote' : 'list']);

        expect([...containers]).toHaveLength(1);
    });
});

describe('what Enter leaves in a code block stays in the block and in its blockquote or list item', () => {
    // A new line that lost its prefix would end the block: `> code` over an
    // empty line is a quote and nothing in it is code any more, and a line
    // at the margin under `- ```` leaves the item and its code block.
    it.each(ENTER_IN_CODE_CASES.map((testCase) => [testCase.name, testCase] as const))('%s', (name, testCase) => {
        const leaves = leavesWithContainer(viewerModel(testCase.source).blocks);
        const read   = leaves.map((leaf) => (leaf.text === undefined ? [leaf.container, leaf.kind] : [leaf.container, leaf.kind, leaf.text]));

        expect(read).toEqual(testCase.reads);
    });
});

describe('generated tab documents', () => {
    /** How many documents are drawn; 591 of them hold a tab. */
    const DRAWS = 600;

    /** These tests load each document several times, which takes longer than the default timeout allows. */
    const TIMEOUT_MS = 120_000;

    /**
     * Writes a document with every tab of a container prefix as the spaces that reach its tab stop.
     *
     * @param document - A document.
     * @returns Its spaces form.
     */
    function spacesForm(document: string): string {
        return expandPrefixTabs(document).text;
    }

    /**
     * Writes the outline of what the viewer reads, without the text of code and raw blocks, where a tab may stand.
     *
     * @param document - A document.
     * @returns The outline.
     */
    function shape(document: string): string {
        return blockOutline(viewerModel(document).blocks).replace(/(code|raw)"[^"]*"/g, '$1');
    }

    /**
     * Tells whether the editor's surface holds the blocks the viewer shows for a document.
     *
     * @param document - A document.
     * @returns `true` when they are the same.
     */
    function agrees(document: string): boolean {
        return JSON.stringify(editorSurfaceModel(loadAndSave(document).editor)) === JSON.stringify(viewerModel(document).blocks);
    }

    it('G1. a tab document reads as its spaces form', () => {
        const differing = tabDocuments(DRAWS).filter((document) => shape(document) !== shape(spacesForm(document)));

        expect(differing.map((document) => JSON.stringify(document))).toEqual([]);
    }, TIMEOUT_MS);

    it('G2. viewer and editor agree on a tab document exactly when they agree on its spaces form', () => {
        const differing = tabDocuments(DRAWS).filter((document) => agrees(document) !== agrees(spacesForm(document)));

        expect(differing.map((document) => JSON.stringify(document))).toEqual([]);
    }, TIMEOUT_MS);

    it('G3. an unedited tab document is saved byte for byte, and the save reloads to itself', () => {
        const differing = tabDocuments(DRAWS).filter((document) => {
            const { saved } = loadAndSave(document);

            return saved !== document || loadAndSave(saved).saved !== saved;
        });

        expect(differing.map((document) => JSON.stringify(document))).toEqual([]);
    }, TIMEOUT_MS);
});

describe('corpus integrity', () => {
    it('case names are unique', () => {
        const names = CORPUS.map((testCase) => testCase.name);

        expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
    });

    it('every divergence reason is named by at least one case', () => {
        const used = new Set(CORPUS.flatMap((testCase) => Object.values(testCase.known ?? {})));

        expect(Object.keys(DIVERGENCES).filter((id) => !used.has(id as keyof typeof DIVERGENCES))).toEqual([]);
    });
});
