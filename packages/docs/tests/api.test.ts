import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    API_PREFIX,
    isApiPath,
    apiFileFor,
    apiRouteFor,
    apiDirOf,
    getApiNav,
    moduleCount,
    symbolCount,
    fetchApiPage,
    MODULE_INDEX_FILES,
    KIND_LABELS,
} from '../src/content/api.js';
import type { ApiNavNode } from '../src/content/api.js';
import { apiFiles } from 'virtual:typedoc-api';

/** Finds a node by walking `path` segments of child labels from `nodes`. */
function findByLabels(nodes: ApiNavNode[], ...labels: string[]): ApiNavNode {
    let level = nodes;
    let found: ApiNavNode | undefined;

    for (const label of labels) {
        found = level.find((node) => node.label === label);
        if (!found) {
            throw new Error(`no node labelled ${label} among [${level.map((n) => n.label).join(', ')}]`);
        }
        level = found.children;
    }

    return found!;
}

describe('API_PREFIX', () => {
    it('is /api', () => {
        expect(API_PREFIX).toBe('/api');
    });
});

describe('isApiPath', () => {
    it('is true for /api and a nested /api path', () => {
        expect(isApiPath('/api')).toBe(true);
        expect(isApiPath('/api/core')).toBe(true);
    });

    it('is false for a non-API path, including one that merely starts with the same letters', () => {
        expect(isApiPath('/guide')).toBe(false);
        expect(isApiPath('/apiary')).toBe(false);
    });
});

describe('apiFileFor', () => {
    it.each([
        ['/api', 'index.md'],
        ['/api/core', 'core/index.md'],
        ['/api/core/classes/Component', 'core/classes/Component.md'],
        ['/api/component/button', 'component/button/index.md'],
        ['/api/core/namespaces/Animation', 'core/namespaces/Animation/index.md'],
        ['/api/component', 'component/index.md'],
    ])('maps %s to %s', (path, file) => {
        expect(apiFileFor(path)).toBe(file);
    });

    it('returns null for a route with no matching generated file', () => {
        expect(apiFileFor('/api/nope')).toBeNull();
    });
});

describe('apiRouteFor', () => {
    it.each([
        ['index.md', '/api'],
        ['core/index.md', '/api/core'],
        ['core/classes/Component.md', '/api/core/classes/Component'],
        ['component/index.md', '/api/component'],
    ])('maps %s to %s', (file, route) => {
        expect(apiRouteFor(file)).toBe(route);
    });

    it('round-trips through apiFileFor for every non-null path in the generated nav tree', () => {
        function walk(nodes: ApiNavNode[]): string[] {
            return nodes.flatMap((node) => [
                ...(node.path !== null ? [node.path] : []),
                ...walk(node.children),
            ]);
        }

        const routes = walk(getApiNav());
        expect(routes.length).toBeGreaterThan(0);

        for (const route of routes) {
            const file = apiFileFor(route);
            expect(file, `${route} did not resolve to a file`).not.toBeNull();
            expect(apiRouteFor(file!)).toBe(route);
        }
    });
});

describe('apiFiles', () => {
    it('has no two entries mapping to the same route', () => {
        const routes = apiFiles.map((file) => apiRouteFor(file));

        expect(new Set(routes).size).toBe(routes.length);
    });
});

describe('status-bar counts', () => {
    // Pinned deliberately: they are what the status bar shows today, so a
    // change to either is a regression until someone regenerates the API
    // tree and updates both this test and the plan's table.
    it('moduleCount() is 18', () => {
        expect(moduleCount()).toBe(18);
    });

    it('symbolCount() is 683', () => {
        expect(symbolCount()).toBe(683);
    });

    it('moduleCount() equals the apiFiles entries ending /index.md outside /namespaces/', () => {
        const expected = apiFiles.filter(
            (file) => file.endsWith('/index.md') && !file.includes('/namespaces/'),
        ).length;

        expect(moduleCount()).toBe(expected);
    });

    it('symbolCount() equals apiFiles.length minus the entries named index.md', () => {
        const indexCount = apiFiles.filter((file) => file === 'index.md' || file.endsWith('/index.md')).length;

        expect(symbolCount()).toBe(apiFiles.length - indexCount);
    });
});

describe('apiDirOf', () => {
    it('returns the directory part of a file path', () => {
        expect(apiDirOf('core/classes/Component.md')).toBe('core/classes');
    });

    it('returns an empty string for a file at the tree root', () => {
        expect(apiDirOf('index.md')).toBe('');
    });

    it("returns 'component' for the synthesized component index file", () => {
        expect(apiDirOf('component/index.md')).toBe('component');
    });
});

describe('getApiNav', () => {
    it('resolves every non-null path through apiFileFor', () => {
        function walk(nodes: ApiNavNode[]): void {
            for (const node of nodes) {
                if (node.path !== null) {
                    expect(apiFileFor(node.path), `${node.path} has no file`).not.toBeNull();
                }
                walk(node.children);
            }
        }

        walk(getApiNav());
    });
});

describe('getApiNav kind grouping', () => {
    it('root children are the module directories, including router', () => {
        const labels = getApiNav().map((node) => node.label);

        expect(labels).toEqual([
            'component', 'core', 'data', 'layout', 'overlay', 'primitive', 'router', 'validation',
        ]);
    });

    it("core's own node opens /api/core", () => {
        const core = findByLabels(getApiNav(), 'core');

        expect(core.path).toBe('/api/core');
    });

    it("core's children are its kind directories", () => {
        const core = findByLabels(getApiNav(), 'core');

        expect(core.children.map((node) => node.label)).toEqual([
            'Classes', 'Functions', 'Interfaces', 'Namespaces', 'Type Aliases', 'Variables',
        ]);
    });

    it('core > Classes is a grouping node containing the Component leaf', () => {
        const classes   = findByLabels(getApiNav(), 'core', 'Classes');
        const component = classes.children.find((node) => node.label === 'Component');

        expect(classes.path).toBeNull();
        expect(component?.path).toBe('/api/core/classes/Component');
    });

    it('core > Type Aliases contains the Handle leaf', () => {
        const typeAliases = findByLabels(getApiNav(), 'core', 'Type Aliases');
        const handle      = typeAliases.children.find((node) => node.label === 'Handle');

        expect(handle?.path).toBe('/api/core/type-aliases/Handle');
    });

    it('core > Namespaces > Animation opens its own page and groups by kind', () => {
        const animation = findByLabels(getApiNav(), 'core', 'Namespaces', 'Animation');

        expect(animation.path).toBe('/api/core/namespaces/Animation');
        expect(animation.children.map((node) => node.label)).toEqual(['Functions', 'Interfaces']);
    });

    it('core > Namespaces > Animation > Functions contains the play leaf', () => {
        const functions = findByLabels(getApiNav(), 'core', 'Namespaces', 'Animation', 'Functions');

        expect(functions.children.some((node) => node.label === 'play')).toBe(true);
    });

    it('every node labelled with a KIND_LABELS value is a grouping-only node', () => {
        const kindLabelValues = new Set(Object.values(KIND_LABELS));

        (function walk(nodes: ApiNavNode[]): void {
            for (const node of nodes) {
                if (kindLabelValues.has(node.label)) {
                    expect(node.path, `${node.label} should be a grouping node`).toBeNull();
                }
                walk(node.children);
            }
        })(getApiNav());
    });

    it('every directory with no index.md of its own that is not first-level is a known kind', () => {
        // The plan's literal rule: a directory with no real index.md is
        // either first-level (a module directory, e.g. `component`) or one
        // of TypeDoc's kind directories — nothing else. A namespace instance
        // (e.g. `core/namespaces/Animation`) always has its own index.md, so
        // it is excluded by the "has no index.md" clause alone, with no
        // separate carve-out needed. Checked directly against `apiFiles`
        // rather than any derived module-directory predicate, so this can
        // actually fail when a genuinely new, unmapped kind directory (say
        // `core/accessors/foo.md`) appears after a TypeDoc upgrade.
        const dirsWithIndex = new Set(
            apiFiles
                .filter((file) => file.endsWith('/index.md'))
                .map((file) => file.slice(0, -'/index.md'.length)),
        );

        const dirs = new Set<string>();
        for (const file of apiFiles) {
            const segments = file.split('/').slice(0, -1);
            for (let i = 1; i <= segments.length; i++) {
                dirs.add(segments.slice(0, i).join('/'));
            }
        }

        for (const dir of dirs) {
            const isFirstLevel = !dir.includes('/');
            const hasOwnIndex  = dirsWithIndex.has(dir);

            if (!hasOwnIndex && !isFirstLevel) {
                const lastSegment = dir.slice(dir.lastIndexOf('/') + 1);

                expect(KIND_LABELS, `unmapped directory "${dir}"`).toHaveProperty(lastSegment);
            }
        }
    });
});

describe('MODULE_INDEX_FILES', () => {
    it('has nineteen entries', () => {
        expect(MODULE_INDEX_FILES.size).toBe(19);
    });

    it('includes every real and synthesized module index', () => {
        expect(MODULE_INDEX_FILES.has('component/index.md')).toBe(true);
        expect(MODULE_INDEX_FILES.has('component/button/index.md')).toBe(true);
        expect(MODULE_INDEX_FILES.has('core/index.md')).toBe(true);
    });

    it('excludes the root index, namespace indexes, and symbol pages', () => {
        expect(MODULE_INDEX_FILES.has('index.md')).toBe(false);
        expect(MODULE_INDEX_FILES.has('core/namespaces/Animation/index.md')).toBe(false);
        expect(MODULE_INDEX_FILES.has('core/classes/Component.md')).toBe(false);
    });
});

describe('the component nav node', () => {
    it('opens /api/component and has eleven children', () => {
        const component = findByLabels(getApiNav(), 'component');

        expect(component.path).toBe('/api/component');
        expect(component.children.length).toBe(11);
    });
});

describe('fetchApiPage', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('synthesizes core/index.md without calling fetch', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);

        const source = await fetchApiPage('core/index.md');

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(source).toContain('## Classes');
        expect(source).toContain('## Namespaces');
        expect(source).not.toContain('## Theme');
        expect(source).not.toContain('## Other');
    });

    it('synthesizes component/index.md without calling fetch', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);

        const source = await fetchApiPage('component/index.md');

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(source).toContain('## Modules');
        expect(source).toContain('- [button](button/index.md)');
    });

    it('fetches a namespace index for real — it is not synthesized', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok:   true,
            text: () => Promise.resolve('# Animation\n'),
        });
        vi.stubGlobal('fetch', fetchSpy);

        await fetchApiPage('core/namespaces/Animation/index.md');

        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
});

describe('getApiNav ordering', () => {
    // Both trees — this machine-generated one and the authored sidebar in
    // pages.ts — use the same compareLabels comparator, so their ordering
    // rules agree.
    const byLabel = (a: string, b: string): number =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

    it('orders every level branches-first, then leaves, each alphanumerically', () => {
        function check(nodes: ApiNavNode[], where: string): void {
            const labels   = nodes.map((node) => node.label);
            const branches = nodes.filter((node) => node.children.length > 0).map((node) => node.label);
            const leaves   = nodes.filter((node) => node.children.length === 0).map((node) => node.label);

            expect(labels, `${where}: branches must precede leaves`)
                .toEqual([...branches, ...leaves]);
            expect(branches, `${where}: branches out of order`)
                .toEqual([...branches].sort(byLabel));
            expect(leaves, `${where}: leaves out of order`)
                .toEqual([...leaves].sort(byLabel));

            for (const node of nodes) {
                check(node.children, `${where} > ${node.label}`);
            }
        }

        check(getApiNav(), 'root');
    });

    it('sorts without dropping or duplicating a node', () => {
        const paths: string[] = [];

        (function collect(nodes: ApiNavNode[]): void {
            for (const node of nodes) {
                if (node.path !== null) {
                    paths.push(node.path);
                }

                collect(node.children);
            }
        })(getApiNav());

        expect(paths.length).toBeGreaterThan(600);
        expect(new Set(paths).size).toBe(paths.length);
    });
});
