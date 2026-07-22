import { describe, it, expect } from 'vitest';
import { getPage, getNav } from '../src/content/pages.js';
import { notFoundSource, fetchErrorSource } from '../src/content/notFound.js';
import type { NavEntry, NavGroup } from '../src/content/pages.js';

// Independent of pages.ts's own glob, so the bijection test below is a real
// cross-check rather than comparing the implementation against itself.
const ALL_DOC_KEYS = Object.keys(
    import.meta.glob('../../lib/docs/{guide,concepts,components,layouts,data,recipes,reference}/*.md'),
);

function routePathForTest(globKey: string): string {
    const withoutPrefix = globKey.replace(/^\.\.\/\.\.\/lib\/docs/, '');
    const withoutExt    = withoutPrefix.replace(/\.md$/, '');

    return withoutExt.replace(/\/index$/, '');
}

const ALL_PAGE_PATHS = new Set(ALL_DOC_KEYS.map(routePathForTest));

/** Recursively collects every {@link NavEntry} under `groups`, `pages` first, then nested `groups`. */
function flattenEntries(groups: NavGroup[]): NavEntry[] {
    return groups.flatMap((group) => [...group.pages, ...flattenEntries(group.groups ?? [])]);
}

describe('getPage', () => {
    it('returns a page with non-empty source and the title from the first # heading', () => {
        const page = getPage('/guide/installation');

        expect(page).not.toBeNull();
        expect(page!.source.length).toBeGreaterThan(0);
        expect(page!.title).toBe('Installation');
    });

    it('resolves the directory path to its index.md', () => {
        const page = getPage('/guide');

        expect(page).not.toBeNull();
        expect(page!.path).toBe('/guide');
    });

    it('returns null for a path with no matching file', () => {
        expect(getPage('/nope')).toBeNull();
    });

    it.each([
        '/components/Table',
        '/layouts/HBox',
        '/data/store',
        '/recipes/crud-table',
        '/reference/faq',
    ])('returns a page with non-empty source for %s', (path) => {
        const page = getPage(path);

        expect(page).not.toBeNull();
        expect(page!.source.length).toBeGreaterThan(0);
    });

    it('resolves the components section path to its index.md, with no trailing slash', () => {
        const page = getPage('/components');

        expect(page).not.toBeNull();
        expect(page!.path).toBe('/components');
    });

    it('returns null for an /api/ path — api/ is not globbed', () => {
        expect(getPage('/api/core/classes/Component')).toBeNull();
    });
});

describe('getNav', () => {
    const nav = getNav();

    it('returns exactly the seven sections, in order', () => {
        expect(nav.map((group) => group.title)).toEqual([
            'Guide', 'Concepts', 'Components', 'Layouts', 'Data', 'Recipes', 'Reference',
        ]);
    });

    it('every page path resolves through getPage', () => {
        for (const entry of flattenEntries(nav)) {
            expect(getPage(entry.path)).not.toBeNull();
        }
    });

    it('no page path ends in a trailing slash', () => {
        for (const entry of flattenEntries(nav)) {
            expect(entry.path.endsWith('/')).toBe(false);
        }
    });

    it('no nav label leaks raw Markdown from a heading', () => {
        const labels = flattenEntries(nav).map((entry) => entry.label);

        expect(labels.some((label) => label.includes('`'))).toBe(false);
    });

    it('labels the sidebar with the config.mts titles, not the page h1 headings', () => {
        const labels = flattenEntries(nav).map((entry) => entry.label);

        // These diverge from the page's own first `# ` heading, so they prove
        // the sidebar uses the hand-authored config.mts title.
        expect(labels).toContain('Introduction');
        expect(labels).toContain('Overview');
        expect(labels).toContain('DOM seams');
    });

    it('flattens to exactly 154 distinct entries', () => {
        const paths = flattenEntries(nav).map((entry) => entry.path);

        expect(paths.length).toBe(154);
        expect(new Set(paths).size).toBe(154);
    });

    it('has the expected per-section entry counts', () => {
        const counts = Object.fromEntries(
            nav.map((group) => [group.title, flattenEntries([group]).length]),
        );

        expect(counts).toEqual({
            Guide:      3,
            Concepts:   13,
            Components: 92,
            Layouts:    17,
            Data:       7,
            Recipes:    15,
            Reference:  7,
        });
    });

    it('nests subgroups only under Components (13), Layouts (3), and Recipes (5)', () => {
        const groupCounts = Object.fromEntries(
            nav.map((group) => [group.title, group.groups?.length ?? 0]),
        );

        expect(groupCounts).toEqual({
            Guide:      0,
            Concepts:   0,
            Components: 13,
            Layouts:    3,
            Data:       0,
            Recipes:    5,
            Reference:  0,
        });
    });

    it('the set of flattened nav paths equals the set of getPage-resolvable paths', () => {
        const navPaths = new Set(flattenEntries(nav).map((entry) => entry.path));

        for (const path of navPaths) {
            expect(ALL_PAGE_PATHS.has(path), `nav path ${path} has no corresponding file`).toBe(true);
        }

        for (const path of ALL_PAGE_PATHS) {
            expect(navPaths.has(path), `file for ${path} is missing from the nav table`).toBe(true);
        }
    });
});

describe('notFoundSource', () => {
    // The corpus links the API reference as `/api/`, which the router's
    // normalizePath collapses to `/api` before the handler sees it — so a
    // startsWith('/api/') test alone misses the two most prominent API links
    // in the corpus (the Guide landing page and the Components catalog).
    it('names the API reference for the bare /api root', () => {
        expect(notFoundSource('/api')).toContain('API reference');
    });

    it('names the API reference for a nested API path', () => {
        expect(notFoundSource('/api/core/classes/Component')).toContain('API reference');
    });

    it('uses the generic message for a non-API path', () => {
        const source = notFoundSource('/nope');

        expect(source).toContain('Not found');
        expect(source).not.toContain('API reference');
    });

    it('does not treat a path merely prefixed with "api" as the API reference', () => {
        expect(notFoundSource('/apiary')).not.toContain('API reference');
    });

    it('names the API reference for a path with no matching generated file', () => {
        expect(notFoundSource('/api/nope')).toContain('API reference');
    });
});

describe('fetchErrorSource', () => {
    it('names the path and the API reference', () => {
        const source = fetchErrorSource('/api/core/classes/Component');

        expect(source).toContain('/api/core/classes/Component');
        expect(source).toContain('API reference');
    });
});
