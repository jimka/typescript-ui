import { describe, it, expect, vi } from 'vitest';
import packageJson from '../../package.json';

// Regression guard for the defect found in Loom: importing
// `@jimka/typescript-ui/component/editor` where there is no DOM (a Vitest
// `node` suite, a build-time script) threw `ReferenceError: document is not
// defined`, because a module's top-level code wrote to the shared stylesheet
// the instant it was evaluated. Every non-wildcard `package.json` `exports`
// key is imported here, in a fresh module graph with the production seams
// (not the node test harness's modelled DOM), so any import-time DOM access
// anywhere in that entry's module graph throws exactly as it does for a real
// consumer.
const ENTRY_KEYS = Object.keys(packageJson.exports).filter((key) => !key.includes('*'));

// Every entry imports cleanly: `core/Body.ts` constructs its singleton on
// first use, so nothing in the library renders at import. A new entry that
// reintroduces an import-time DOM touch fails here rather than reaching a
// consumer.
const KNOWN_IMPORT_TIME_DOM: ReadonlySet<string> = new Set<string>();

/**
 * Translates a `package.json` `exports` key into the source barrel it maps
 * to under `~`, so the guard imports the library's own source rather than a
 * built `dist` artefact.
 *
 * @param exportKey - A non-wildcard `exports` key, e.g. `"./component/editor"`.
 * @returns The matching source specifier, e.g. `"~/component/editor/index"`.
 */
function sourceSpecifier(exportKey: string): string {
    return '~' + exportKey.slice(1) + '/index';
}

// Vitest's default per-test timeout is 5s. A cold import of `./glyphs`
// transforms roughly 2,860 glyph modules and measured close to 6s while
// drafting this guard; every other entry took well under a second. 30s
// leaves headroom on a slower machine — a derived value isn't possible here,
// since transform time depends on the machine and the module-transform cache.
const ENTRY_IMPORT_TIMEOUT_MS = 30_000;

describe('import without a DOM', () => {
    it('G1. this file really runs with no DOM present', () => {
        expect(typeof document).toBe('undefined');
    });

    it.each(ENTRY_KEYS)('%s', async (exportKey) => {
        vi.resetModules();

        const { DOM, ProductionDOMSink } = await import('~/core/DOM');
        expect(DOM.sink).toBeInstanceOf(ProductionDOMSink);

        const load = import(/* @vite-ignore */ sourceSpecifier(exportKey));

        if (KNOWN_IMPORT_TIME_DOM.has(exportKey)) {
            await expect(load).rejects.toThrow(/document is not defined/);
        } else {
            await expect(load).resolves.toBeDefined();
        }
    }, ENTRY_IMPORT_TIMEOUT_MS);
});
