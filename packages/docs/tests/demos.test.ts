// @vitest-environment jsdom
//
// demos.ts eagerly imports every module in src/demos/, and a demo module
// constructs library components — button-basic.ts imports `Panel` from
// `@jimka/typescript-ui/core`, whose bundled module evaluates a top-level
// `Body` singleton that reads `document` at import time. The rest of this
// package's tests run fine under vitest's default `node` environment (see
// content-constructs.test.ts, pages.test.ts), but this file needs a real DOM
// the moment it imports demos.ts.
import { describe, it, expect } from 'vitest';
import { getDemo, getDemoIds, missingDemoSource } from '../src/content/demos.js';
import { DEMO_OPEN, DEMO_CLOSE } from '../src/content/blocks.js';

// Same glob pattern as content-constructs.test.ts, read independently here
// so the corpus↔registry bijection (cases 16-17) is a real cross-check
// rather than comparing pages.ts or demos.ts against themselves.
const RAW_SOURCES = import.meta.glob(
    '../../lib/docs/{guide,concepts,components,layouts,data,recipes,reference}/*.md',
    { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const PAGES = Object.entries(RAW_SOURCES);

/**
 * The same slug rule `Markdown`'s viewer applies, duplicated from
 * `content-constructs.test.ts` (the library has no public export for it).
 *
 * @param text - The heading's plain text.
 * @returns The slug, with no leading, trailing, or doubled hyphens.
 */
function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** Every `<!-- demo: … -->` marker id found anywhere in the corpus. */
const CORPUS_MARKER_IDS = PAGES.flatMap(([, raw]) =>
    [...raw.matchAll(/^<!--\s*demo:\s*([a-z0-9-]+)\s*-->$/gm)].map((match) => match[1]));

describe('getDemo', () => {
    it('resolves button-basic to its module and source', () => {
        const entry = getDemo('button-basic');

        expect(entry).not.toBeNull();
        expect(typeof entry!.module.height).toBe('number');
        expect(typeof entry!.module.create).toBe('function');
        expect(entry!.source).toContain('export function create');
    });

    it('returns null for an unknown id', () => {
        expect(getDemo('no-such-demo')).toBeNull();
    });
});

describe('missingDemoSource', () => {
    it('names the missing demo', () => {
        expect(missingDemoSource('x')).toContain('x');
        expect(missingDemoSource('x').toLowerCase()).toContain('missing');
    });
});

describe('corpus↔registry bijection', () => {
    it('resolves every corpus marker through getDemo', () => {
        const unresolved = CORPUS_MARKER_IDS.filter((id) => getDemo(id) === null);

        expect(unresolved, `unresolved marker ids: ${unresolved.join(', ')}`).toHaveLength(0);
    });

    it('has every getDemoIds() id appear in at least one corpus marker', () => {
        const unused = getDemoIds().filter((id) => !CORPUS_MARKER_IDS.includes(id));

        expect(unused, `demo ids with no corpus marker: ${unused.join(', ')}`).toHaveLength(0);
    });
});

/** Whether `raw`'s lines contain at least one demo open marker. */
function hasMarker(raw: string): boolean {
    return raw.split('\n').some((line) => DEMO_OPEN.test(line));
}

describe('corpus marker guards', () => {
    it.each(PAGES.filter(([, raw]) => hasMarker(raw)))(
        '%s has no two headings sharing a slug',
        (path, raw) => {
            const seen = new Map<string, number>();

            for (const match of raw.matchAll(/^#{1,6}[ \t]+(.+)$/gm)) {
                const slug = slugify(match[1]);

                seen.set(slug, (seen.get(slug) ?? 0) + 1);
            }

            const duplicated = [...seen.entries()].filter(([, count]) => count > 1).map(([slug]) => slug);

            expect(duplicated, `${path} has duplicate heading slug(s): ${duplicated.join(', ')}`).toHaveLength(0);
        },
    );

    it.each(PAGES)('%s balances its demo markers', (path, raw) => {
        const lines = raw.split('\n');
        let open = false;

        for (const line of lines) {
            const isOpen  = DEMO_OPEN.test(line);
            const isClose = DEMO_CLOSE.test(line);

            if (isOpen) {
                expect(open, `${path} opens a demo marker while one is already open`).toBe(false);
                open = true;
            } else if (isClose) {
                expect(open, `${path} closes a demo marker with no matching open`).toBe(true);
                open = false;
            }
        }

        expect(open, `${path} leaves a demo marker open at end of page`).toBe(false);
    });

    it.each(PAGES)('%s has no heading inside a fallback region', (path, raw) => {
        const lines = raw.split('\n');
        let inFallback = false;
        const offenders: string[] = [];

        for (const line of lines) {
            if (DEMO_OPEN.test(line)) {
                inFallback = true;
                continue;
            }
            if (DEMO_CLOSE.test(line)) {
                inFallback = false;
                continue;
            }
            if (inFallback && /^#{1,6}[ \t]/.test(line)) {
                offenders.push(line);
            }
        }

        expect(offenders, `${path} has heading(s) inside a demo fallback region: ${offenders.join(', ')}`).toHaveLength(0);
    });

    it.each(PAGES)('%s only links absolute https:// URLs inside a fallback region', (path, raw) => {
        const lines = raw.split('\n');
        let inFallback = false;
        const offenders: string[] = [];

        for (const line of lines) {
            if (DEMO_OPEN.test(line)) {
                inFallback = true;
                continue;
            }
            if (DEMO_CLOSE.test(line)) {
                inFallback = false;
                continue;
            }
            if (inFallback) {
                for (const match of line.matchAll(/]\(([^)]+)\)/g)) {
                    if (!match[1].startsWith('https://')) {
                        offenders.push(match[1]);
                    }
                }
            }
        }

        expect(offenders, `${path} links non-absolute URL(s) inside a demo fallback region: ${offenders.join(', ')}`).toHaveLength(0);
    });
});
