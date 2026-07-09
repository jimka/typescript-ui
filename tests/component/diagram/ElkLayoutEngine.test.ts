import { describe, it, expect } from 'vitest';
import { buildElkGraph, mapElkResult } from '~/component/diagram/ElkLayoutEngine';
import type { DiagramData } from '~/component/diagram/DiagramModel';

// U1 — model → ELK mapping, and the result → coords mapping. Both mapping
// functions are pure and synchronous, so they are exercised directly with no
// `elkjs` import.

describe('ElkLayoutEngine — buildElkGraph', () => {
    it('maps nodes to ELK children, honouring explicit sizes then the sizes map', () => {
        const data: DiagramData = {
            nodes: [
                { id: 'a', width: 50, height: 30, layoutOptions: { 'elk.nodeSize': '1' } },
                { id: 'b', label: 'B' },
                { id: 'c' },
            ],
            edges: [],
        };

        const sizes = new Map([['b', { width: 80, height: 40 }]]);

        const graph = buildElkGraph(data, sizes);

        expect(graph.id).toBe('root');
        expect(graph.children).toEqual([
            { id: 'a', width: 50, height: 30, layoutOptions: { 'elk.nodeSize': '1' } },
            { id: 'b', width: 80, height: 40, layoutOptions: undefined },
            // No explicit size, no sizes-map entry — the default fallback box.
            { id: 'c', width: 120, height: 40, layoutOptions: undefined },
        ]);
    });

    it('maps single source/target edges to ELK source/target lists', () => {
        const data: DiagramData = {
            nodes: [{ id: 'a' }, { id: 'b' }],
            edges: [{ id: 'e', source: 'a', target: 'b' }],
        };

        const graph = buildElkGraph(data, new Map());

        expect(graph.edges).toEqual([{ id: 'e', sources: ['a'], targets: ['b'] }]);
    });

    it('maps node ports to ELK ports, with a side hint becoming elk.port.side', () => {
        const data: DiagramData = {
            nodes: [{ id: 'a', ports: [{ id: 'p', x: 0, y: 30, width: 1, height: 1, side: 'WEST' }] }],
            edges: [],
        };

        const graph = buildElkGraph(data, new Map());

        expect(graph.children?.[0].ports).toEqual([
            { id: 'p', x: 0, y: 30, width: 1, height: 1, layoutOptions: { 'elk.port.side': 'WEST' } },
        ]);
    });

    it('maps a sideless port with layoutOptions left undefined (not an empty object)', () => {
        const data: DiagramData = {
            nodes: [{ id: 'a', ports: [{ id: 'p', x: 0, y: 0 }] }],
            edges: [],
        };

        const graph = buildElkGraph(data, new Map());

        expect(graph.children?.[0].ports).toEqual([
            { id: 'p', x: 0, y: 0, width: undefined, height: undefined, layoutOptions: undefined },
        ]);
    });

    it('routes an edge through its sourcePort/targetPort when set', () => {
        const data: DiagramData = {
            nodes: [{ id: 'a' }, { id: 'b' }],
            edges: [{ id: 'e', source: 'a', target: 'b', sourcePort: 'a::c::out', targetPort: 'b::d::in' }],
        };

        const graph = buildElkGraph(data, new Map());

        expect(graph.edges).toEqual([{ id: 'e', sources: ['a::c::out'], targets: ['b::d::in'] }]);
    });

    it('falls back to the node id when an edge carries no ports (regression)', () => {
        const data: DiagramData = {
            nodes: [{ id: 'a' }, { id: 'b' }],
            edges: [{ id: 'e', source: 'a', target: 'b' }],
        };

        const graph = buildElkGraph(data, new Map());

        expect(graph.edges).toEqual([{ id: 'e', sources: ['a'], targets: ['b'] }]);
    });

    it('maps a container node (non-empty children) to a nested ElkNode with no width/height', () => {
        const data: DiagramData = {
            nodes: [
                {
                    id: 'schema:public',
                    label: 'public',
                    children: [
                        { id: 'public.users', width: 50, height: 30 },
                        { id: 'public.orders' },
                    ],
                },
            ],
            edges: [],
        };

        const sizes = new Map([['public.orders', { width: 90, height: 40 }]]);

        const graph = buildElkGraph(data, sizes);

        expect(graph.children).toEqual([
            {
                id: 'schema:public',
                // The default container padding reserves top clearance for
                // DiagramGroupNode's header label — see the next test.
                layoutOptions: { 'elk.padding': expect.any(String) },
                children: [
                    { id: 'public.users', width: 50, height: 30, layoutOptions: undefined, ports: undefined },
                    { id: 'public.orders', width: 90, height: 40, layoutOptions: undefined, ports: undefined },
                ],
            },
        ]);
        // A container carries no explicit size — ELK computes it from contents.
        expect(graph.children?.[0]).not.toHaveProperty('width');
        expect(graph.children?.[0]).not.toHaveProperty('height');
    });

    it('gives a container a top padding wide enough to clear the DiagramGroupNode header, overridable by the node\'s own layoutOptions', () => {
        const data: DiagramData = {
            nodes: [{ id: 'schema:public', children: [{ id: 'public.users' }] }],
            edges: [],
        };

        const graph = buildElkGraph(data, new Map());
        const padding = graph.children?.[0].layoutOptions?.['elk.padding'];

        // The exact spacing is an implementation detail; what matters is a
        // non-zero top inset (so the container box leaves room above its
        // children for the header label DiagramGroupNode paints).
        expect(padding).toBeDefined();
        expect(padding).toMatch(/top\s*=\s*(?!0\b)\d/);

        const overridden = buildElkGraph(
            {
                nodes: [{ id: 'schema:public', layoutOptions: { 'elk.padding': '[top=1,left=1,bottom=1,right=1]' }, children: [{ id: 'public.users' }] }],
                edges: [],
            },
            new Map(),
        );

        expect(overridden.children?.[0].layoutOptions).toEqual({ 'elk.padding': '[top=1,left=1,bottom=1,right=1]' });
    });

    it('recurses through nested containers (a container inside a container)', () => {
        const data: DiagramData = {
            nodes: [
                {
                    id: 'outer',
                    children: [
                        { id: 'inner', children: [{ id: 'leaf' }] },
                    ],
                },
            ],
            edges: [],
        };

        const graph = buildElkGraph(data, new Map());

        const outer = graph.children?.[0];
        expect(outer?.id).toBe('outer');
        const inner = outer?.children?.[0];
        expect(inner?.id).toBe('inner');
        expect(inner).not.toHaveProperty('width');
        expect(inner?.children).toEqual([
            { id: 'leaf', width: 120, height: 40, layoutOptions: undefined, ports: undefined },
        ]);
    });

    it('a leaf node (empty or absent children) maps exactly as today', () => {
        const data: DiagramData = {
            nodes: [{ id: 'a', children: [] }, { id: 'b' }],
            edges: [],
        };

        const graph = buildElkGraph(data, new Map());

        expect(graph.children).toEqual([
            { id: 'a', width: 120, height: 40, layoutOptions: undefined, ports: undefined },
            { id: 'b', width: 120, height: 40, layoutOptions: undefined, ports: undefined },
        ]);
    });

    it('sets elk.hierarchyHandling=INCLUDE_CHILDREN on the root, overridable by data.layoutOptions', () => {
        const data: DiagramData = { nodes: [], edges: [] };

        const graph = buildElkGraph(data, new Map());
        expect(graph.layoutOptions).toMatchObject({ 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' });

        const overridden = buildElkGraph(
            { ...data, layoutOptions: { 'elk.hierarchyHandling': 'SEPARATE_CHILDREN' } },
            new Map(),
        );
        expect(overridden.layoutOptions).toMatchObject({ 'elk.hierarchyHandling': 'SEPARATE_CHILDREN' });
    });

    it('merges graph options over defaults on the root; per-node options ride on the child', () => {
        const data: DiagramData = {
            nodes: [{ id: 'a', layoutOptions: { 'elk.algorithm': 'force' } }],
            edges: [],
            layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' },
        };

        const graph = buildElkGraph(data, new Map(), { 'elk.algorithm': 'stress', 'elk.spacing': '20' });

        // Graph wins over defaults on the root: algorithm=layered, spacing kept.
        // hierarchyHandling is the lowest-precedence tier (below defaults/graph),
        // unset by either here, so its own default value survives.
        expect(graph.layoutOptions).toEqual({
            'elk.algorithm':         'layered',
            'elk.spacing':           '20',
            'elk.direction':         'RIGHT',
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        });

        // Per-node option rides on the child so ELK resolves it over the
        // inherited root options — per-node wins over graph wins over defaults.
        expect(graph.children?.[0].layoutOptions).toEqual({ 'elk.algorithm': 'force' });
    });
});

describe('ElkLayoutEngine — mapElkResult', () => {
    it('maps annotated ELK output back to node coords, edge sections, and graph bounds', () => {
        const result = mapElkResult({
            id:     'root',
            width:  200,
            height: 100,
            children: [{ id: 'a', x: 10, y: 20, width: 50, height: 30 }],
            edges: [{
                id: 'e',
                sources: ['a'],
                targets: ['b'],
                sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 5, y: 5 } }],
            }],
        });

        expect(result.width).toBe(200);
        expect(result.height).toBe(100);
        expect(result.nodes).toEqual([{ id: 'a', x: 10, y: 20, width: 50, height: 30 }]);
        expect(result.edges).toEqual([{ id: 'e', sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 5, y: 5 } }] }]);
    });

    it('defaults missing coordinate / size / section fields to zero / empty', () => {
        const result = mapElkResult({ id: 'root', children: [{ id: 'a' }], edges: [{ id: 'e', sources: ['a'], targets: ['a'] }] });

        expect(result.width).toBe(0);
        expect(result.height).toBe(0);
        expect(result.nodes).toEqual([{ id: 'a', x: 0, y: 0, width: 0, height: 0 }]);
        expect(result.edges).toEqual([{ id: 'e', sections: [] }]);
    });

    it('flattens a container\'s parent-relative child coords to absolute, emitting both the container and its children', () => {
        const result = mapElkResult({
            id: 'root',
            width: 300,
            height: 200,
            children: [
                {
                    id: 'schema:public',
                    x: 10, y: 20, width: 150, height: 100,
                    children: [
                        // Coordinates below are relative to the container's own
                        // top-left (10, 20), per ELK's nested-result convention.
                        { id: 'public.users', x: 5, y: 8, width: 50, height: 30 },
                        { id: 'public.orders', x: 5, y: 50, width: 50, height: 30 },
                    ],
                },
            ],
            edges: [],
        });

        expect(result.nodes).toEqual([
            { id: 'schema:public', x: 10, y: 20, width: 150, height: 100 },
            // Absolute = container origin (10, 20) + child-relative (5, 8) / (5, 50).
            { id: 'public.users', x: 15, y: 28, width: 50, height: 30 },
            { id: 'public.orders', x: 15, y: 70, width: 50, height: 30 },
        ]);
    });

    it('flattens nested containers by accumulating offsets through each level', () => {
        const result = mapElkResult({
            id: 'root',
            children: [
                {
                    id: 'outer',
                    x: 100, y: 100, width: 200, height: 200,
                    children: [
                        {
                            id: 'inner',
                            x: 10, y: 10, width: 100, height: 100,
                            children: [{ id: 'leaf', x: 5, y: 5, width: 20, height: 20 }],
                        },
                    ],
                },
            ],
            edges: [],
        });

        expect(result.nodes).toEqual([
            { id: 'outer', x: 100, y: 100, width: 200, height: 200 },
            { id: 'inner', x: 110, y: 110, width: 100, height: 100 },
            { id: 'leaf', x: 115, y: 115, width: 20, height: 20 },
        ]);
    });

    it('a flat (no-children) result maps exactly as today', () => {
        const result = mapElkResult({
            id: 'root',
            width: 200,
            height: 100,
            children: [{ id: 'a', x: 10, y: 20, width: 50, height: 30 }],
            edges: [],
        });

        expect(result.nodes).toEqual([{ id: 'a', x: 10, y: 20, width: 50, height: 30 }]);
    });

    it('shifts an intra-container edge\'s route by its container\'s absolute origin', () => {
        // ELK routes an edge between two nodes nested in the same container in
        // that container's frame, and tags it with `container`. Its section
        // coordinates are relative to the container's top-left (10, 20), so the
        // absolute route is that origin plus each reported point.
        const result = mapElkResult({
            id: 'root',
            children: [
                {
                    id: 'schema:public',
                    x: 10, y: 20, width: 150, height: 100,
                    children: [
                        { id: 'public.orders', x: 12, y: 12, width: 120, height: 40 },
                        { id: 'public.customers', x: 152, y: 12, width: 120, height: 40 },
                    ],
                },
            ],
            edges: [{
                id: 'e',
                sources: ['public.orders'],
                targets: ['public.customers'],
                container: 'schema:public',
                sections: [{
                    startPoint: { x: 132, y: 32 },
                    bendPoints: [{ x: 142, y: 32 }],
                    endPoint:   { x: 152, y: 32 },
                }],
            }],
        });

        expect(result.edges).toEqual([{
            id: 'e',
            sections: [{
                startPoint: { x: 142, y: 52 },
                bendPoints: [{ x: 152, y: 52 }],
                endPoint:   { x: 162, y: 52 },
            }],
        }]);
    });

    it('collects and offsets an edge nested inside a container\'s own edges array', () => {
        // Some ELK results place a routed edge in the container node's `edges`
        // rather than the root's, with no explicit `container`; its frame is
        // then that container. Both placements must map to the same absolute
        // route.
        const result = mapElkResult({
            id: 'root',
            children: [
                {
                    id: 'schema:public',
                    x: 10, y: 20, width: 150, height: 100,
                    children: [{ id: 'public.orders', x: 12, y: 12, width: 120, height: 40 }],
                    edges: [{
                        id: 'e',
                        sources: ['public.orders'],
                        targets: ['public.orders'],
                        sections: [{ startPoint: { x: 1, y: 2 }, endPoint: { x: 3, y: 4 } }],
                    }],
                },
            ],
            edges: [],
        });

        expect(result.edges).toEqual([{
            id: 'e',
            sections: [{ startPoint: { x: 11, y: 22 }, endPoint: { x: 13, y: 24 } }],
        }]);
    });
});
