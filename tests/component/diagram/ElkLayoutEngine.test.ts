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

    it('merges graph options over defaults on the root; per-node options ride on the child', () => {
        const data: DiagramData = {
            nodes: [{ id: 'a', layoutOptions: { 'elk.algorithm': 'force' } }],
            edges: [],
            layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' },
        };

        const graph = buildElkGraph(data, new Map(), { 'elk.algorithm': 'stress', 'elk.spacing': '20' });

        // Graph wins over defaults on the root: algorithm=layered, spacing kept.
        expect(graph.layoutOptions).toEqual({
            'elk.algorithm': 'layered',
            'elk.spacing':   '20',
            'elk.direction': 'RIGHT',
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
});
