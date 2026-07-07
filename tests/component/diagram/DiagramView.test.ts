import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { Component } from '~/core/Component';
import { _DiagramView } from '~/component/diagram/DiagramView';
import { _DiagramEdgeLayer } from '~/component/diagram/DiagramEdgeLayer';
import type { DiagramData, DiagramNodeData } from '~/component/diagram/DiagramModel';
import type { DiagramLayoutResult } from '~/component/diagram/ElkLayoutEngine';
import { installTestDOM, makeEvent, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/**
 * A controllable stand-in for `ElkLayoutEngine`. In `resolve` mode it resolves
 * immediately with a fixed result; in `reject` mode it rejects (ELK-absent); in
 * `defer` mode it parks each promise so a test can resolve them out of order to
 * exercise the stale-layout guard.
 */
class StubEngine {
    lastArgs: { data: DiagramData; sizes: Map<string, { width: number; height: number }>; defaults?: Record<string, string> } | null = null;
    private _deferred: Array<{ resolve: (r: DiagramLayoutResult) => void; reject: (e: unknown) => void }> = [];

    constructor(private _result: DiagramLayoutResult, private _mode: 'resolve' | 'reject' | 'defer' = 'resolve') {}

    layout(data: DiagramData, sizes: Map<string, { width: number; height: number }>, defaults?: Record<string, string>): Promise<DiagramLayoutResult> {
        this.lastArgs = { data, sizes, defaults };

        if (this._mode === 'reject') {
            return Promise.reject(new Error('elkjs unavailable'));
        }

        if (this._mode === 'defer') {
            return new Promise((resolve, reject) => this._deferred.push({ resolve, reject }));
        }

        return Promise.resolve(this._result);
    }

    resolveDeferred(index: number, result: DiagramLayoutResult): void {
        this._deferred[index].resolve(result);
    }
}

// Module-level slot the test subclass's `createEngine` override returns, so the
// stub is in place before the super constructor calls `createEngine`.
let stubEngine: StubEngine;

class StubDiagramView extends _DiagramView {
    protected createEngine(): any {
        return stubEngine;
    }
}

/** Flushes microtasks + a macrotask so the layout `.then` / `.catch` runs. */
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function simpleGraph(): DiagramData {
    return {
        nodes: [{ id: 'a', label: 'Hero' }, { id: 'b', label: 'World' }],
        edges: [{ id: 'e', source: 'a', target: 'b' }],
    };
}

function fixedResult(): DiagramLayoutResult {
    return {
        nodes: [
            { id: 'a', x: 10, y: 20, width: 60, height: 30 },
            { id: 'b', x: 100, y: 200, width: 60, height: 30 },
        ],
        edges: [{ id: 'e', sections: [{ startPoint: { x: 70, y: 35 }, endPoint: { x: 100, y: 215 } }] }],
        width:  160,
        height: 230,
    };
}

let sink: RecordingDOMSink;

beforeEach(() => {
    sink = installTestDOM(CONFIG);
});

afterEach(() => {
    DOM.reset();
});

describe('DiagramView — layout application (U2)', () => {
    it('positions each node at the mapped coords and sizes the content host to graph bounds × zoom', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        const nodeA = view._nodeComponents.get('a');
        const nodeB = view._nodeComponents.get('b');

        expect([nodeA.getX(), nodeA.getY()]).toEqual([10, 20]);
        expect([nodeB.getX(), nodeB.getY()]).toEqual([100, 200]);

        // zoom defaults to 1, so the host box equals the graph bounds.
        expect(view._contentHost.getPreferredSize()).toEqual({ width: 160, height: 230 });
    });
});

describe('DiagramView — node sizing input (U3)', () => {
    it('feeds explicit model sizes to ELK, else the node component preferred size', async () => {
        stubEngine = new StubEngine(fixedResult());

        const data: DiagramData = {
            nodes: [{ id: 'a', width: 50, height: 30 }, { id: 'b' }],
            edges: [],
        };

        // A renderer with a known preferred size, so the fallback is deterministic.
        const view = new StubDiagramView({
            data,
            nodeRenderer: () => new Component({ preferredSize: { width: 77, height: 44 } }),
        });

        await flush();

        const sizes = stubEngine.lastArgs!.sizes;

        expect(sizes.get('a')).toEqual({ width: 50, height: 30 });
        expect(sizes.get('b')).toEqual({ width: 77, height: 44 });
    });
});

describe('DiagramView — selection (U4)', () => {
    it('a node click updates the selection, toggles the node, and fires "selection"', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: DiagramNodeData[][] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { selection: (nodes) => fired.push(nodes) } }) as any;

        await flush();

        const nodeA = view._nodeComponents.get('a');
        const handle: Handle = nodeA.getElement(true);

        view._handleClick(makeEvent(handle, 'click'));

        expect(view.getSelection().map((n: DiagramNodeData) => n.id)).toEqual(['a']);
        expect(nodeA.isSelected()).toBe(true);
        expect(fired).toHaveLength(1);
        expect(fired[0].map((n) => n.id)).toEqual(['a']);
    });

    it('selectNode updates state without emitting, and selectNode(null) clears', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: unknown[] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { selection: () => fired.push(1) } }) as any;

        await flush();

        view.selectNode('b');

        expect(view.getSelection().map((n: DiagramNodeData) => n.id)).toEqual(['b']);
        expect(fired).toHaveLength(0);

        view.selectNode(null);

        expect(view.getSelection()).toEqual([]);
        expect(fired).toHaveLength(0);
    });
});

describe('DiagramView — zoom (U5, U6)', () => {
    it('clamps zoom to [minZoom, maxZoom] and scales the content host transform + size', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        view.setZoom(10);

        expect(view.getZoom()).toBe(4);
        expect(view._contentHost.getTransform()).toBe('scale(4)');
        expect(view._contentHost.getPreferredSize()).toEqual({ width: 160 * 4, height: 230 * 4 });

        view.setZoom(0);

        expect(view.getZoom()).toBe(0.25);
    });

    it('resolves the class-default zoom of 1 through the folding getter (U6)', () => {
        stubEngine = new StubEngine(fixedResult());

        expect(new StubDiagramView().getZoom()).toBe(1);
    });
});

describe('DiagramView — stale-layout guard (U7)', () => {
    it('ignores an older in-flight layout that resolves after a newer setData', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView() as any;

        const firstData: DiagramData = { nodes: [{ id: 'a' }], edges: [] };
        const secondData: DiagramData = { nodes: [{ id: 'z' }], edges: [] };

        view.setData(firstData);   // generation 1 → deferred[0]
        view.setData(secondData);  // generation 2 → deferred[1]

        const firstResult: DiagramLayoutResult = { nodes: [{ id: 'a', x: 1, y: 1, width: 10, height: 10 }], edges: [], width: 10, height: 10 };
        const secondResult: DiagramLayoutResult = { nodes: [{ id: 'z', x: 9, y: 9, width: 20, height: 20 }], edges: [], width: 20, height: 20 };

        // Newer resolves first, then the stale older one.
        stubEngine.resolveDeferred(1, secondResult);
        await flush();

        stubEngine.resolveDeferred(0, firstResult);
        await flush();

        // Only the newer graph's node exists and its coords stuck.
        expect(view._nodeComponents.has('a')).toBe(false);
        expect(view._nodeComponents.get('z').getX()).toBe(9);
        expect(view._contentHost.getPreferredSize()).toEqual({ width: 20, height: 20 });
    });
});

describe('DiagramEdgeLayer — edge routing (U8)', () => {
    it('creates one path per routed edge and clears prior paths on re-setEdges', () => {
        const layer = new _DiagramEdgeLayer();

        layer.getElement(true);  // render the <svg> + defs/marker/arrow
        sink.writes.length = 0;

        layer.setEdges([
            { id: 'e1', sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 10 } }] },
            { id: 'e2', sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 5, y: 5 } }] },
        ]);

        const created = sink.writes.filter((w) => w.op === 'createElementNS' && w.args[1] === 'path').length;
        expect(created).toBe(2);

        sink.writes.length = 0;

        layer.setEdges([{ id: 'e1', sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } }] }]);

        const removed = sink.writes.filter((w) => w.op === 'removeChild').length;
        const recreated = sink.writes.filter((w) => w.op === 'createElementNS' && w.args[1] === 'path').length;

        expect(removed).toBe(2);
        expect(recreated).toBe(1);
    });
});

describe('DiagramView — option routing (U9)', () => {
    it('routes every option to its setter and wires the listeners bag', async () => {
        stubEngine = new StubEngine(fixedResult());

        const layoutFired: number[] = [];
        const customNodes: DiagramNodeData[] = [];

        const view = new StubDiagramView({
            data:          simpleGraph(),
            layoutOptions: { 'elk.algorithm': 'layered' },
            minZoom:       0.5,
            maxZoom:       8,
            zoom:          2,
            nodeRenderer:  (n) => { customNodes.push(n); return new Component({ preferredSize: { width: 30, height: 20 } }); },
            listeners:     { layout: () => layoutFired.push(1) },
        }) as any;

        await flush();

        expect(view.getZoom()).toBe(2);
        expect(view.getData()).toEqual(simpleGraph());
        expect(stubEngine.lastArgs!.defaults).toEqual({ 'elk.algorithm': 'layered' });
        expect(customNodes.map((n) => n.id)).toEqual(['a', 'b']);
        expect(layoutFired).toHaveLength(1);
    });
});

describe('DiagramView — graceful ELK-absent (U10)', () => {
    it('does not throw synchronously and leaves the view empty when layout rejects', async () => {
        stubEngine = new StubEngine(fixedResult(), 'reject');

        const view = new StubDiagramView() as any;

        expect(() => view.setData(simpleGraph())).not.toThrow();

        await flush();

        expect(view._nodeComponents.size).toBe(0);
        expect(view.getSelection()).toEqual([]);
    });
});
