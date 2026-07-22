import { describe, it, expect } from 'vitest';
import {
    API_PREFIX,
    isApiPath,
    apiFileFor,
    apiRouteFor,
    apiDirOf,
    getApiNav,
} from '../src/content/api.js';
import { apiFiles } from 'virtual:typedoc-api';
import type { ApiNavNode } from 'virtual:typedoc-api';

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

describe('apiDirOf', () => {
    it('returns the directory part of a file path', () => {
        expect(apiDirOf('core/classes/Component.md')).toBe('core/classes');
    });

    it('returns an empty string for a file at the tree root', () => {
        expect(apiDirOf('index.md')).toBe('');
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

describe('getApiNav ordering', () => {
    // TypeDoc emits its own kind-based order (namespaces, then classes, then
    // interfaces, …), which is arbitrary to a reader scanning for a symbol.
    // Only this machine-generated tree is sorted: the authored sections keep
    // the hand-curated config.mts order, where "Overview" leading Concepts is
    // deliberate and alphabetising would bury it.
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
