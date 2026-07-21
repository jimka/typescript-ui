import { expandContainers } from './containers.js';

/** A single migrated documentation page. */
export interface DocPage {
    /** The route path, e.g. `/guide/installation` — no trailing slash. */
    path:   string;
    /** The page's title, taken from its first `# ` heading. */
    title:  string;
    /** The page's Markdown source, with `:::` containers already expanded. */
    source: string;
}

/**
 * A sidebar entry: a page's route path plus the label shown for it in the
 * tree. The label is hand-authored from the VitePress sidebar (config.mts)
 * rather than taken from the page's `# ` heading, because the two differ for
 * three pages and a heading may carry inline Markdown (e.g. backticks) that
 * must not leak into a plain tree label.
 */
export interface NavEntry {
    path:  string;
    label: string;
}

/** A sidebar section: a titled group of {@link NavEntry} entries. */
export interface NavGroup {
    title: string;
    pages: NavEntry[];
}

// `import.meta.glob` keys arrive as `../../../lib/docs/guide/installation.md`
// relative to this file (packages/docs/src/content/pages.ts), so
// `../../../lib/docs/` resolves to packages/lib/docs/ — the VitePress source
// this app reads unmodified. See "Markdown content migrates as-is" in
// plans/implemented/packages-docs.md.
const RAW_SOURCES = import.meta.glob('../../../lib/docs/{guide,concepts}/*.md', {
    query:  '?raw',
    import: 'default',
    eager:  true,
}) as Record<string, string>;

/**
 * Maps a glob key to its route path: strips the `../../../lib/docs` prefix
 * and the `.md` extension, and collapses a trailing `index` onto the
 * directory path — `.../guide/index.md` becomes `/guide`, not `/guide/`,
 * matching what the library `Router` hands a route handler (it normalizes
 * away a trailing slash).
 *
 * @param globKey - The glob-relative path, e.g. `../../../lib/docs/guide/index.md`.
 * @returns The route path, e.g. `/guide`.
 */
function routePathFor(globKey: string): string {
    const withoutPrefix = globKey.replace(/^\.\.\/\.\.\/\.\.\/lib\/docs/, '');
    const withoutExt    = withoutPrefix.replace(/\.md$/, '');

    return withoutExt.replace(/\/index$/, '');
}

/**
 * Reads a page's title from its first `# ` heading, authored in every one of
 * the 15 Phase-1 pages.
 *
 * @param source - The page's Markdown source.
 * @returns The heading text, or `''` if the source has no `# ` heading.
 */
function titleFor(source: string): string {
    const match = /^# (.+)$/m.exec(source);

    return match ? match[1].trim() : '';
}

const PAGES = new Map<string, DocPage>(
    Object.entries(RAW_SOURCES).map(([globKey, raw]) => {
        const path   = routePathFor(globKey);
        const source = expandContainers(raw);

        return [path, { path, title: titleFor(source), source }];
    }),
);

/**
 * Looks up a migrated page by its route path.
 *
 * @param path - The route path, e.g. `/guide/installation`.
 * @returns The matching {@link DocPage}, or `null` when the path is not one
 *   of the migrated pages.
 */
export function getPage(path: string): DocPage | null {
    return PAGES.get(path) ?? null;
}

/**
 * Looks up a nav table entry, throwing if it isn't a migrated page — a broken
 * entry in the hand-authored {@link getNav} table is an authoring error, not
 * a runtime condition to handle gracefully.
 *
 * @param path - The route path to look up.
 * @returns The matching {@link DocPage}.
 */
function requirePage(path: string): DocPage {
    const page = getPage(path);

    if (page === null) {
        throw new Error(`packages/docs nav table references an unmigrated page: ${path}`);
    }

    return page;
}

/**
 * The sidebar's Guide and Concepts sections, mirroring the VitePress sidebar
 * shape in packages/lib/docs/.vitepress/config.mts (same titles, same order)
 * — see "Route ⇄ file mapping" in plans/implemented/packages-docs.md. Each
 * label is copied from that config's `text`, not derived from the page's `# `
 * heading, so the tree reads exactly as VitePress renders it.
 *
 * @returns The two nav groups for the Phase-1 content slice.
 */
export function getNav(): NavGroup[] {
    const guide: NavEntry[] = [
        { path: '/guide',              label: 'Introduction' },
        { path: '/guide/installation', label: 'Installation' },
        { path: '/guide/mental-model', label: 'Mental model' },
    ];
    const concepts: NavEntry[] = [
        { path: '/concepts',                     label: 'Overview' },
        { path: '/concepts/component-lifecycle', label: 'Component lifecycle' },
        { path: '/concepts/construction',        label: 'Constructing components' },
        { path: '/concepts/layout-system',       label: 'Layout system' },
        { path: '/concepts/sizing',              label: 'Sizing' },
        { path: '/concepts/events',              label: 'Events' },
        { path: '/concepts/layering',            label: 'Layering' },
        { path: '/concepts/theming',             label: 'Theming' },
        { path: '/concepts/data-binding',        label: 'Data binding' },
        { path: '/concepts/routing',             label: 'Routing' },
        { path: '/concepts/accessibility',       label: 'Accessibility' },
        { path: '/concepts/performance',         label: 'Performance' },
        { path: '/concepts/dom-seams',           label: 'DOM seams' },
    ];

    // Fail loudly on a hand-authored path that doesn't resolve to a migrated
    // page — an authoring typo, not a runtime condition to handle gracefully.
    [...guide, ...concepts].forEach((entry) => requirePage(entry.path));

    return [
        { title: 'Guide',    pages: guide },
        { title: 'Concepts', pages: concepts },
    ];
}
