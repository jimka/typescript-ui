import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { libraryAliases } from '../../../build/libraryBuildAlias.js';
import { outsideAppSource } from '../vite/plugins.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_LIB = path.join(HERE, 'fixtures/lib');
const REAL_LIB = path.resolve(HERE, '../../lib');

/**
 * Resolves `id` the way Vite applies an alias list: the first entry whose
 * `find` matches rewrites the id with `String.replace`.
 *
 * @param aliases - The alias list, in match order.
 * @param id - The import specifier.
 * @returns The rewritten id, or `null` when no alias matches.
 */
function applyAliases(aliases: Array<{ find: RegExp; replacement: string }>, id: string): string | null {
    const hit = aliases.find((alias) => alias.find.test(id));

    return hit ? id.replace(hit.find, hit.replacement) : null;
}

describe('E10 libraryAliases', () => {
    const aliases = libraryAliases(FIXTURE_LIB);

    it.each([
        ['@jimka/typescript-ui/core', 'dist/lib/core.es.js'],
        ['@jimka/typescript-ui/component/chart', 'dist/lib/component/chart.es.js'],
        ['@jimka/typescript-ui/glyphs/solid', 'dist/lib/glyphs/solid/index.es.js'],
        ['@jimka/typescript-ui/glyphs/solid/star', 'dist/lib/glyphs/solid/star.es.js'],
    ])('aliases %s to the build file', (id, file) => {
        expect(applyAliases(aliases, id)).toBe(path.join(FIXTURE_LIB, file));
    });

    it('leaves an unexported subpath unaliased', () => {
        expect(applyAliases(aliases, '@jimka/typescript-ui/nope')).toBeNull();
    });

    it('gives the real library one alias per exports key, each into its build', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(REAL_LIB, 'package.json'), 'utf8')) as { exports: Record<string, unknown> };
        const real = libraryAliases(REAL_LIB);

        expect(real).toHaveLength(Object.keys(pkg.exports).length);

        for (const alias of real) {
            expect(alias.replacement.startsWith(path.join(REAL_LIB, 'dist/lib') + path.sep)).toBe(true);
        }
    });
});

describe('E12 outsideAppSource', () => {
    const ignored = outsideAppSource('/r/packages/qa');

    it.each([
        '/r/packages/qa',
        '/r/packages/qa/index.html',
        '/r/packages/qa/src/panels/chart-line.ts',
        '/r/packages/qa/tests/run.test.ts',
    ])('watches %s', (file) => {
        expect(ignored(file)).toBe(false);
    });

    it.each([
        '/r/packages/qa/results/x.json',
        '/r/packages/qa/logs/vite-x.log',
        '/r/packages/qa/bin/qa-table.py',
        '/r/packages/qa/srcx/a.ts',
        '/r/packages/lib/dist/lib/core.es.js',
    ])('ignores %s', (file) => {
        expect(ignored(file)).toBe(true);
    });
});
