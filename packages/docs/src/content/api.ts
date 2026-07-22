import { apiFiles } from 'virtual:typedoc-api';
import { normalizeApiMarkdown, moduleIndexSource, collapseModuleGroups } from './apiMarkdown.js';
import type { IndexSection } from './apiMarkdown.js';
import { compareLabels } from './labelOrder.js';

/** A node in the API Reference sidebar tree. */
export interface ApiNavNode {
    label:    string;
    /** The route this entry opens, or null for a grouping-only entry. */
    path:     string | null;
    children: ApiNavNode[];
}

/** Route path prefix every API page lives under. */
export const API_PREFIX = '/api';

const FILES = new Set(apiFiles);

/**
 * Display label for each of TypeDoc's reflection-kind directories — the
 * seven possible last segments of a symbol's own directory. Any other
 * directory name (a module or a namespace instance) is used verbatim.
 * Exported so the kind-label coverage test can check every directory in
 * `apiFiles` against this map itself, rather than a copy that could drift
 * from it.
 */
export const KIND_LABELS: Record<string, string> = {
    classes:        'Classes',
    enumerations:   'Enumerations',
    functions:      'Functions',
    interfaces:     'Interfaces',
    namespaces:     'Namespaces',
    'type-aliases': 'Type Aliases',
    variables:      'Variables',
};

/**
 * The display label for a directory node: its {@link KIND_LABELS} entry when
 * it names a TypeDoc kind, otherwise the directory name itself.
 *
 * @param name - A single path segment (directory name).
 * @returns The label to render for that directory's node.
 */
function directoryLabel(name: string): string {
    return KIND_LABELS[name] ?? name;
}

/**
 * Every module directory's index file, whether or not it exists on disk —
 * see "Which index files the app synthesizes" in the plan's `## Internal
 * Structure`. For every file in `apiFiles`, each ancestor directory in its
 * chain is a module directory when no segment of its path is `namespaces`
 * and its last segment is not a {@link KIND_LABELS} key.
 */
export const MODULE_INDEX_FILES: Set<string> = (() => {
    const moduleDirs = new Set<string>();

    for (const file of apiFiles) {
        const dirNames = file.split('/').slice(0, -1);

        for (let depth = 1; depth <= dirNames.length; depth++) {
            const dirPath     = dirNames.slice(0, depth).join('/');
            const lastSegment = dirNames[depth - 1];

            if (!dirNames.slice(0, depth).includes('namespaces') && !(lastSegment in KIND_LABELS)) {
                moduleDirs.add(dirPath);
            }
        }
    }

    return new Set(Array.from(moduleDirs, (dir) => `${dir}/index.md`));
})();

/**
 * First-level module directories with no real `index.md` in `FILES` — the
 * smaller list the root index collapses each one's submodule run onto.
 */
const MODULE_GROUPS: string[] = Array.from(MODULE_INDEX_FILES)
    .filter((file) => !file.slice(0, -'/index.md'.length).includes('/') && !FILES.has(file))
    .map((file) => file.slice(0, -'/index.md'.length));

/**
 * True when `path` is inside the API reference — `/api` itself or any path
 * nested under it.
 *
 * @param path - The route path to test.
 */
export function isApiPath(path: string): boolean {
    return path === API_PREFIX || path.startsWith(API_PREFIX + '/');
}

/**
 * Maps an API route to its generated file, trying `<rest>.md` first and
 * `<rest>/index.md` second — the same rule TypeDoc's own output follows for a
 * module/namespace index versus a leaf symbol page.
 *
 * @param path - The route path, e.g. `/api/core/classes/Component`.
 * @returns The file path relative to `packages/lib/docs/api`, or `null` when
 *   no generated file matches.
 */
export function apiFileFor(path: string): string | null {
    if (!isApiPath(path)) return null;

    const rest = path.slice(API_PREFIX.length).replace(/^\//, '');
    const direct = rest === '' ? 'index.md' : rest + '.md';

    if (FILES.has(direct)) return direct;

    const index = rest === '' ? null : rest + '/index.md';

    return index !== null && (FILES.has(index) || MODULE_INDEX_FILES.has(index)) ? index : null;
}

/**
 * Maps a generated file back to its API route — the inverse of
 * {@link apiFileFor}.
 *
 * @param file - The file path relative to `packages/lib/docs/api`.
 * @returns The route path, e.g. `/api/core/classes/Component`.
 */
export function apiRouteFor(file: string): string {
    const withoutExt   = file.replace(/\.md$/, '');
    const withoutIndex = withoutExt === 'index' ? '' : withoutExt.replace(/\/index$/, '');

    return withoutIndex === '' ? API_PREFIX : `${API_PREFIX}/${withoutIndex}`;
}

/**
 * The directory part of a file path.
 *
 * @param file - The file path relative to `packages/lib/docs/api`.
 * @returns The directory, or `''` for a file at the tree root.
 */
export function apiDirOf(file: string): string {
    const slash = file.lastIndexOf('/');

    return slash === -1 ? '' : file.slice(0, slash);
}

/**
 * Builds a module node's page sections: one per kind directory child, headed
 * by the kind's display label, plus a single `Modules` section collecting
 * any submodule children — see "Building a module's sections" in the plan's
 * `## Internal Structure`. Read off {@link getApiNav}'s already-sorted tree,
 * so a page's sections come out in the same order as the tree beside it.
 *
 * @param node - The module's own {@link ApiNavNode}.
 * @param dir - The module's directory path, e.g. `core` or `component`.
 * @returns The page's sections, in tree order.
 */
function moduleSections(node: ApiNavNode, dir: string): IndexSection[] {
    const kinds = node.children.filter((child) => child.path === null);
    const subs  = node.children.filter((child) => child.path !== null);
    const link  = (child: ApiNavNode, text: string): { text: string; href: string } =>
        ({ text, href: apiFileFor(child.path!)!.slice(dir.length + 1) });

    return [
        ...(subs.length > 0
            ? [{ heading: 'Modules', links: subs.map((child) => link(child, `${dir}/${child.label}`)) }]
            : []),
        ...kinds.map((kind) => ({
            heading: kind.label,
            links:   kind.children.map((child) => link(child, child.label)),
        })),
    ];
}

/**
 * Fetches an API page's Markdown, normalized for the library viewer. A
 * module index in {@link MODULE_INDEX_FILES} is synthesized from the nav
 * tree with no network request; the root index additionally has its
 * `component/*` run collapsed onto one line. Rejects on a non-OK response.
 *
 * @param file - The file path relative to `packages/lib/docs/api`.
 * @returns The page's Markdown source, ready for `Markdown.setMarkdown`.
 */
export async function fetchApiPage(file: string): Promise<string> {
    if (MODULE_INDEX_FILES.has(file)) {
        const dir  = apiDirOf(file);
        const node = NAV_BY_PATH.get(apiRouteFor(file))!;

        return moduleIndexSource(dir, moduleSections(node, dir));
    }

    const response = await fetch(`${import.meta.env.BASE_URL}api/${file}`);

    if (!response.ok) {
        throw new Error(`Failed to fetch API page ${file}: ${response.status}`);
    }

    const source = normalizeApiMarkdown(await response.text());

    return file === 'index.md' ? collapseModuleGroups(source, MODULE_GROUPS) : source;
}

/** A node under construction: same shape as {@link ApiNavNode}, but with a `Map` of children for O(1) lookup by path segment while building. */
interface ApiNavBuilderNode {
    label:    string;
    path:     string | null;
    children: Map<string, ApiNavBuilderNode>;
}

/**
 * Builds the API tree as a directory trie over `files` — see "Deriving the
 * API tree from `apiFiles`" in the plan's `## Internal Structure`. A file
 * named `index.md` sets its containing directory node's `path` rather than
 * becoming a child of its own; any other file becomes a leaf node.
 *
 * @param files - Every generated API page, as a path relative to the API tree root.
 * @returns The unsorted API tree.
 */
function buildApiNav(files: string[]): ApiNavNode[] {
    const root = new Map<string, ApiNavBuilderNode>();

    const ensureChild = (level: Map<string, ApiNavBuilderNode>, name: string): ApiNavBuilderNode => {
        const existing = level.get(name);
        if (existing) return existing;

        const node: ApiNavBuilderNode = { label: directoryLabel(name), path: null, children: new Map() };
        level.set(name, node);

        return node;
    };

    for (const file of files) {
        if (file === 'index.md') continue; // the API Reference root's own page

        const segments = file.split('/');
        const filename  = segments[segments.length - 1];
        const dirNames  = segments.slice(0, -1);

        let level = root;
        let dirNode: ApiNavBuilderNode | undefined;

        for (const name of dirNames) {
            dirNode = ensureChild(level, name);
            level = dirNode.children;
        }

        if (filename === 'index.md') {
            dirNode!.path = apiRouteFor(file);
        } else {
            const label = filename.replace(/\.md$/, '');

            level.set(label, { label, path: apiRouteFor(file), children: new Map() });
        }
    }

    // A directory with no real index.md (e.g. `component`) is still a module
    // directory when MODULE_INDEX_FILES covers it — give its node the
    // synthesized page's route rather than leaving it null.
    (function fillSyntheticPaths(level: Map<string, ApiNavBuilderNode>, prefix: string): void {
        for (const [name, node] of level) {
            const dirPath = prefix === '' ? name : `${prefix}/${name}`;

            if (node.path === null && MODULE_INDEX_FILES.has(`${dirPath}/index.md`)) {
                node.path = apiRouteFor(`${dirPath}/index.md`);
            }

            fillSyntheticPaths(node.children, dirPath);
        }
    })(root, '');

    const toNodes = (level: Map<string, ApiNavBuilderNode>): ApiNavNode[] =>
        Array.from(level.values()).map((node) => ({
            label:    node.label,
            path:     node.path,
            children: toNodes(node.children),
        }));

    return toNodes(root);
}

/**
 * Orders one level of the API tree: grouping nodes first, then pages, each
 * run sorted alphanumerically by label.
 *
 * @param nodes - One level's nodes, in TypeDoc's order.
 * @returns A new, ordered array; `nodes` is not mutated.
 */
function sortApiNodes(nodes: ApiNavNode[]): ApiNavNode[] {
    const branches = nodes.filter((node) => node.children.length > 0);
    const leaves   = nodes.filter((node) => node.children.length === 0);
    const byLabel  = (a: ApiNavNode, b: ApiNavNode): number => compareLabels(a.label, b.label);

    return [
        ...branches.sort(byLabel).map((node) => ({ ...node, children: sortApiNodes(node.children) })),
        ...leaves.sort(byLabel),
    ];
}

const API_NAV = sortApiNodes(buildApiNav(apiFiles));

/** Every {@link ApiNavNode} with a non-null path, keyed by that path. */
const NAV_BY_PATH = new Map<string, ApiNavNode>();

(function indexByPath(nodes: ApiNavNode[]): void {
    for (const node of nodes) {
        if (node.path !== null) {
            NAV_BY_PATH.set(node.path, node);
        }
        indexByPath(node.children);
    }
})(API_NAV);

/**
 * The API Reference sidebar root, ready for `Tree.setNodes`.
 *
 * @returns The API tree, normalized to app routes and ordered by {@link sortApiNodes}.
 */
export function getApiNav(): ApiNavNode[] {
    return API_NAV;
}

/**
 * The number of TypeDoc modules in the generated tree — the status bar's
 * first count.
 *
 * @returns The count of `apiFiles` entries ending `/index.md` whose path
 *   does not contain `/namespaces/`.
 */
export function moduleCount(): number {
    return apiFiles.filter((file) => file.endsWith('/index.md') && !file.includes('/namespaces/')).length;
}

/**
 * The number of generated symbol pages — the status bar's second count.
 *
 * @returns `apiFiles.length` minus the number of entries whose name is `index.md`.
 */
export function symbolCount(): number {
    return apiFiles.filter((file) => !file.endsWith('index.md')).length;
}
