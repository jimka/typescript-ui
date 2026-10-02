import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { assertCheck, checkTitle, loadAndSave } from './harness';
import { editorSurfaceModel, linkTargets, viewerModel } from './viewModel';
import { CORPUS } from './corpus';
import { DIVERGENCES } from './corpus/divergences';
import type { CorpusCase } from './corpus/types';

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
    });
}

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
