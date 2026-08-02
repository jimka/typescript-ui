import { describe, it, expect } from 'vitest';
import { getPage, getNav } from '../src/content/pages.js';
import { notFoundSource, fetchErrorSource } from '../src/content/notFound.js';
import { compareLabels } from '../src/content/labelOrder.js';
import type { NavEntry, NavGroup } from '../src/content/pages.js';

// Independent of pages.ts's own glob, so the bijection test below is a real
// cross-check rather than comparing the implementation against itself.
// `reference/changelog` is listed explicitly because its per-version pages
// sit one directory deeper than the other six groups.
const ALL_DOC_KEYS = Object.keys(
    import.meta.glob('../../lib/docs/{guide,concepts,components,layouts,data,recipes,reference,reference/changelog}/*.md'),
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

/** Recursively collects every group `path` (when defined) plus every entry `path`. */
function flattenPaths(groups: NavGroup[]): string[] {
    return groups.flatMap((group) => [
        ...(group.path !== undefined ? [group.path] : []),
        ...group.pages.map((entry) => entry.path),
        ...flattenPaths(group.groups ?? []),
    ]);
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

    it('returns the seven section paths, in order', () => {
        expect(nav.map((group) => group.path)).toEqual([
            '/guide', '/concepts', '/components', '/layouts', '/data', '/recipes', '/reference',
        ]);
    });

    it('every section path resolves through getPage', () => {
        for (const group of nav) {
            expect(getPage(group.path!)).not.toBeNull();
        }
    });

    it("every subgroup has an undefined path, except Reference's Changelog", () => {
        (function walk(groups: NavGroup[]): void {
            for (const group of groups) {
                for (const subgroup of group.groups ?? []) {
                    if (subgroup.title === 'Changelog') {
                        expect(subgroup.path).toBe('/reference/changelog');
                    } else {
                        expect(subgroup.path).toBeUndefined();
                    }
                    walk([subgroup]);
                }
            }
        })(nav);
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
        expect(labels).toContain('DOM seams');
        expect(labels).toContain('Drag-and-drop');
    });

    it('no longer carries the index-page labels — those moved onto the group path', () => {
        const labels = flattenEntries(nav).map((entry) => entry.label);

        expect(labels).not.toContain('Introduction');
        expect(labels).not.toContain('Catalog');
        expect(labels.every((label) => label !== 'Overview')).toBe(true);
    });

    it('flattens to exactly 151 distinct leaf entries', () => {
        const paths = flattenEntries(nav).map((entry) => entry.path);

        expect(paths.length).toBe(151);
        expect(new Set(paths).size).toBe(151);
    });

    it('leaf entries plus section paths total 159 distinct paths', () => {
        const paths = flattenPaths(nav);

        expect(paths.length).toBe(159);
        expect(new Set(paths).size).toBe(159);
    });

    it('has the expected per-section leaf entry counts', () => {
        const counts = Object.fromEntries(
            nav.map((group) => [group.title, flattenEntries([group]).length]),
        );

        expect(counts).toEqual({
            Guide:      2,
            Concepts:   12,
            Components: 91,
            Layouts:    16,
            Data:       6,
            Recipes:    14,
            Reference:  10,
        });
    });

    it('nests subgroups only under Components (13), Layouts (3), Recipes (5), and Reference (1)', () => {
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
            Reference:  1,
        });
    });

    it("Guide's pages are in compareLabels order", () => {
        const guide = nav.find((group) => group.title === 'Guide')!;

        expect(guide.pages.map((entry) => entry.label)).toEqual(['Installation', 'Mental model']);
    });

    it("Reference's pages are in compareLabels order", () => {
        const reference = nav.find((group) => group.title === 'Reference')!;

        expect(reference.pages.map((entry) => entry.label)).toEqual([
            'Browser support', 'FAQ', 'Glossary', 'Migration', 'Troubleshooting',
        ]);
    });

    it("Reference's Changelog subgroup pages are in compareLabels order", () => {
        const reference = nav.find((group) => group.title === 'Reference')!;
        const changelog = reference.groups!.find((group) => group.title === 'Changelog')!;

        expect(changelog.pages.map((entry) => entry.label)).toEqual([
            '0.1.0', '0.1.1', '0.2.0', '0.3.0', '0.4.0',
        ]);
    });

    it("Data's pages are in compareLabels order", () => {
        const data = nav.find((group) => group.title === 'Data')!;

        expect(data.pages.map((entry) => entry.label)).toEqual([
            'Associations', 'Binding', 'Model', 'Proxy', 'Record', 'Store',
        ]);
    });

    it("Components' subgroups are in compareLabels order", () => {
        const components = nav.find((group) => group.title === 'Components')!;

        expect(components.groups!.map((group) => group.title)).toEqual([
            'Buttons', 'Charts', 'Containers', 'Core', 'Diagram', 'Display',
            'Inputs', 'Lists', 'Menus', 'Scrolling', 'Table', 'Toolbar', 'Tree',
        ]);
    });

    it("Recipes' subgroups are in compareLabels order", () => {
        const recipes = nav.find((group) => group.title === 'Recipes')!;

        expect(recipes.groups!.map((group) => group.title)).toEqual([
            'Construction patterns', 'Data + UI', 'Local development',
            'Theming + interaction', 'Windows + dialogs',
        ]);
    });

    it("Layouts' subgroups and pages are in compareLabels order", () => {
        const layouts = nav.find((group) => group.title === 'Layouts')!;

        expect(layouts.groups!.map((group) => group.title)).toEqual([
            'Docking', 'Layout managers', 'Serialization',
        ]);
        expect(layouts.pages.map((entry) => entry.label)).toEqual(['Constraints']);
    });

    it('every group at every depth is internally sorted by compareLabels', () => {
        (function walk(groups: NavGroup[]): void {
            for (const group of groups) {
                const labels = group.pages.map((entry) => entry.label);
                expect(labels, `${group.title}.pages`).toEqual([...labels].sort(compareLabels));

                const titles = (group.groups ?? []).map((subgroup) => subgroup.title);
                expect(titles, `${group.title}.groups`).toEqual([...titles].sort(compareLabels));

                walk(group.groups ?? []);
            }
        })(nav);
    });

    it('the set of flattened nav+section paths equals the set of getPage-resolvable paths', () => {
        const navPaths = new Set(flattenPaths(nav));

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
