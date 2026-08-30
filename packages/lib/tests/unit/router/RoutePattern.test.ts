// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pure-logic suite for the route-pattern mechanics behind Router: hash/path
// normalization, pattern compilation (including the ambiguity key), match +
// param extraction, and specificity ranking. No DOM seam involved.
import { describe, it, expect } from 'vitest';
import { normalizePath, splitPath, splitFragment, splitQuery, parseQuery, formatQuery, sameQuery, compilePattern, matchPattern, selectPattern, normalizeBase, stripBase, joinBase, type CompiledPattern } from '~/router/RoutePattern';

describe('normalizePath', () => {
    it.each([
        ['',                        '/'],
        ['#',                       '/'],
        ['#/',                      '/'],
        ['#/settings',              '/settings'],
        ['#/settings/',             '/settings'],
        ['settings',                '/settings'],
        ['#/a//b',                  '/a/b'],
        ['#/settings?tab=advanced', '/settings'],
        ['#/?x=1',                  '/'],
    ])('normalizes %j to %j', (input, expected) => {
        expect(normalizePath(input)).toBe(expected);
    });
});

describe('splitPath', () => {
    it('splits a normalized path into its non-empty segments', () => {
        expect(splitPath('/data/rows/42')).toEqual(['data', 'rows', '42']);
        expect(splitPath('/')).toEqual([]);
    });
});

describe('splitFragment', () => {
    it.each([
        ['/concepts/sizing#the-size-invariant', '/concepts/sizing', 'the-size-invariant'],
        ['/concepts/sizing',                    '/concepts/sizing', ''],
        ['/concepts/sizing#',                   '/concepts/sizing', ''],
        ['#the-size-invariant',                 '',                 'the-size-invariant'],
        ['/a#b#c',                              '/a',               'b#c'],
        ['',                                    '',                 ''],
    ])('splits %j into path %j and fragment %j', (input, path, fragment) => {
        expect(splitFragment(input)).toEqual({ path, fragment });
    });
});

describe('splitQuery', () => {
    it.each([
        ['/guide?a=1',   '/guide', 'a=1'],
        ['/guide',       '/guide', ''],
        ['/guide?',      '/guide', ''],
        ['?a=1',         '',       'a=1'],
        ['/a?b=1?c=2',   '/a',     'b=1?c=2'],
        ['',             '',       ''],
    ])('splits %j into path %j and query %j', (input, path, query) => {
        expect(splitQuery(input)).toEqual({ path, query });
    });
});

describe('parseQuery', () => {
    it.each([
        ['',        {}],
        ['?',       {}],
        ['a=1&b=2', { a: '1', b: '2' }],
        ['?a=1',    { a: '1' }],
        ['rotated', { rotated: '' }],
        ['a=',      { a: '' }],
        ['a=1&a=2', { a: '2' }],
        ['a=1&&b=2', { a: '1', b: '2' }],
        ['=5',      {}],
        ['a=1=2',   { a: '1=2' }],
        ['q=a%20b', { q: 'a b' }],
        ['q=%zz',   { q: '%zz' }],
        ['q=a+b',   { q: 'a+b' }],
        ['a%20b=1', { 'a b': '1' }],
        ['__proto__=x', Object.fromEntries([['__proto__', 'x']])],
    ])('parses %j to %j', (input, expected) => {
        expect(parseQuery(input)).toEqual(expected);
    });
});

describe('formatQuery', () => {
    it.each([
        [{},                  ''],
        [{ a: '1', b: '2' },  'a=1&b=2'],
        [{ b: '2', a: '1' },  'b=2&a=1'],
        [{ a: '' },           'a='],
        [{ q: 'a b' },        'q=a%20b'],
        [{ q: 'a+b' },        'q=a%2Bb'],
        [{ 'a&b': 'c=d' },    'a%26b=c%3Dd'],
    ])('formats %j to %j', (input, expected) => {
        expect(formatQuery(input)).toBe(expected);
    });

    it.each<Record<string, string>>([
        {},
        { a: '1', b: '2' },
        { b: '2', a: '1' },
        { a: '' },
        { q: 'a b' },
        { q: 'a+b' },
        { 'a&b': 'c=d' },
    ])('round-trips through parseQuery: %j', (query) => {
        expect(parseQuery(formatQuery(query))).toEqual(query);
    });
});

describe('sameQuery', () => {
    it.each([
        [{},                    {},                    true],
        [{ a: '1' },            { a: '1' },            true],
        [{ a: '1', b: '2' },    { b: '2', a: '1' },    true],
        [{ a: '1' },            { a: '2' },            false],
        [{ a: '1' },            { a: '1', b: '2' },    false],
        [{ a: '1' },            { b: '1' },            false],
    ])('sameQuery(%j, %j) is %j', (a, b, expected) => {
        expect(sameQuery(a, b)).toBe(expected);
    });
});

describe('compilePattern', () => {
    it('yields static/param segments and a key from literal text / ":"', () => {
        const compiled = compilePattern('/data/rows/:sel');

        expect(compiled.segments).toEqual([
            { kind: 'static', value: 'data' },
            { kind: 'static', value: 'rows' },
            { kind: 'param',  value: 'sel' },
        ]);
        expect(compiled.key).toBe('data/rows/:');
    });

    it('gives two patterns differing only in param name the same key', () => {
        expect(compilePattern('/users/:id').key).toBe(compilePattern('/users/:name').key);
    });

    it('gives patterns with different static segments different keys', () => {
        expect(compilePattern('/a/:x').key).not.toBe(compilePattern('/b/:y').key);
    });

    it('compiles a trailing "*" to a catchAll segment with key "files/*"', () => {
        const compiled = compilePattern('/files/*');

        expect(compiled.segments.at(-1)).toEqual({ kind: 'catchAll', value: '' });
        expect(compiled.key).toBe('files/*');
    });

    it('throws when "*" is not the final segment', () => {
        expect(() => compilePattern('/*/edit')).toThrow();
    });
});

describe('matchPattern', () => {
    it('extracts a single param', () => {
        expect(matchPattern(compilePattern('/data/rows/:sel'), splitPath('/data/rows/42'))).toEqual({ sel: '42' });
    });

    it('returns null when segment counts differ (too few)', () => {
        expect(matchPattern(compilePattern('/data/rows/:sel'), splitPath('/data/rows'))).toBeNull();
    });

    it('returns null when segment counts differ (too many, no catchAll)', () => {
        expect(matchPattern(compilePattern('/data/rows/:sel'), splitPath('/data/rows/42/extra'))).toBeNull();
    });

    it('matches the root pattern against the root path only', () => {
        expect(matchPattern(compilePattern('/'), splitPath('/'))).toEqual({});
        expect(matchPattern(compilePattern('/'), splitPath('/settings'))).toBeNull();
    });

    it('a catchAll matches zero or more trailing segments, yielding no params', () => {
        expect(matchPattern(compilePattern('/files/*'), splitPath('/files'))).toEqual({});
        expect(matchPattern(compilePattern('/files/*'), splitPath('/files/a'))).toEqual({});
        expect(matchPattern(compilePattern('/files/*'), splitPath('/files/a/b/c'))).toEqual({});
    });

    it('decodes a well-formed percent-escape in a param value', () => {
        expect(matchPattern(compilePattern('/users/:id'), splitPath('/users/a%20b'))).toEqual({ id: 'a b' });
    });

    it('falls back to the raw segment text when the percent-escape is malformed', () => {
        expect(matchPattern(compilePattern('/users/:id'), splitPath('/users/%zz'))).toEqual({ id: '%zz' });
    });
});

describe('selectPattern — specificity ranking', () => {
    // Each case is asserted in both array orders, which is what pins
    // order-independence: registration order must never affect the winner.
    function winnerFor(patterns: string[], path: string): string | null {
        const compiled = patterns.map(compilePattern);
        const forward   = selectPattern(compiled, path);
        const backward  = selectPattern(compiled.slice().reverse(), path);

        expect(forward?.compiled.pattern ?? null).toBe(backward?.compiled.pattern ?? null);

        return forward?.compiled.pattern ?? null;
    }

    it('a static segment beats a param at the same position', () => {
        expect(winnerFor(['/data/rows', '/data/:id'], '/data/rows')).toBe('/data/rows');
    });

    it('the param pattern wins when the static pattern does not match', () => {
        expect(winnerFor(['/data/rows', '/data/:id'], '/data/99')).toBe('/data/:id');
    });

    it('a more-specific tail wins at a later differing position', () => {
        expect(winnerFor(['/data/rows/:sel', '/data/:id/:sel'], '/data/rows/7')).toBe('/data/rows/:sel');
    });

    it('a static tail segment beats a param tail segment', () => {
        expect(winnerFor(['/data/:id/edit', '/data/:id/:action'], '/data/9/edit')).toBe('/data/:id/edit');
    });

    it('a more specific catchAll beats a bare catchAll', () => {
        expect(winnerFor(['/files/*', '/*'], '/files/x')).toBe('/files/*');
    });

    it('a static pattern beats a bare catchAll', () => {
        expect(winnerFor(['/data/rows', '/*'], '/data/rows')).toBe('/data/rows');
    });

    it('a longer exact pattern beats a shorter catchAll prefix', () => {
        expect(winnerFor(['/a/b/c', '/a/b/*'], '/a/b/c')).toBe('/a/b/c');
    });

    it('an exact pattern that has ended beats a catchAll at the same path', () => {
        expect(winnerFor(['/a/b', '/a/b/*'], '/a/b')).toBe('/a/b');
    });

    it('returns null when nothing matches, including an empty pattern list', () => {
        expect(selectPattern([] as CompiledPattern[], '/anything')).toBeNull();
    });
});

describe('normalizeBase', () => {
    it.each([
        ['/typescript-ui/', '/typescript-ui/'],
        ['/typescript-ui',  '/typescript-ui/'],
        ['typescript-ui',   '/typescript-ui/'],
        ['/',               '/'],
        ['',                '/'],
    ])('normalizes %j to %j', (base, expected) => {
        expect(normalizeBase(base)).toBe(expected);
    });
});

describe('stripBase', () => {
    it.each([
        ['/typescript-ui/', '/typescript-ui/',                    '/'],
        ['/typescript-ui/', '/typescript-ui',                     '/'],
        ['/typescript-ui/', '/typescript-ui/guide/installation',  '/guide/installation'],
        ['/typescript-ui/', '/typescript-ui/components/',         '/components'],
        ['/typescript-ui/', '/elsewhere',                         '/elsewhere'],
        ['/',               '/guide',                             '/guide'],
    ])('stripBase(%j, %j) is %j', (base, pathname, expected) => {
        expect(stripBase(base, pathname)).toBe(expected);
    });
});

describe('joinBase', () => {
    it.each([
        ['/typescript-ui/', '/guide/installation', '/typescript-ui/guide/installation'],
        ['/typescript-ui/', '/',                    '/typescript-ui/'],
        ['/',               '/guide',               '/guide'],
    ])('joinBase(%j, %j) is %j', (base, path, expected) => {
        expect(joinBase(base, path)).toBe(expected);
    });

    it('keeps the base\'s trailing slash for the root path', () => {
        expect(joinBase('/typescript-ui/', '/')).toBe('/typescript-ui/');
    });
});
