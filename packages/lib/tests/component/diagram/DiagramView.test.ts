import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { Event } from '~/core/Event';
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
    /** How many times the view disposed this engine. */
    disposed = 0;
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

    rejectDeferred(index: number, error: unknown): void {
        this._deferred[index].reject(error);
    }

    dispose(): void {
        this.disposed += 1;
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

/** A root card too large to fit the 1280×800 test viewport whole. */
function oversizedNodeResult(): DiagramLayoutResult {
    return {
        nodes: [
            { id: 'a', x: 100, y: 50, width: 2000, height: 1000 },
            { id: 'b', x: 2300, y: 0, width: 60, height: 30 },
        ],
        edges: [],
        width:  2400,
        height: 1100,
    };
}

/** Stands in for the post-depth-change re-layout: same node ids, moved. */
function movedRootResult(): DiagramLayoutResult {
    return {
        nodes: [
            { id: 'a', x: 500, y: 400, width: 60, height: 30 },
            { id: 'b', x: 900, y: 700, width: 60, height: 30 },
        ],
        edges: [],
        width:  2000,
        height: 1200,
    };
}

/** Parses a `translate(Xpx, Ypx) scale(Z)` transform string into its parts. */
function parseTransform(transform: string): { panX: number; panY: number; zoom: number } {
    const match = transform.match(/^translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\((-?[\d.]+)\)$/);

    if (!match) {
        throw new Error(`transform did not match the expected format: ${transform}`);
    }

    return { panX: Number(match[1]), panY: Number(match[2]), zoom: Number(match[3]) };
}

/** Maps a viewport-relative point back to graph coordinates from the current transform. */
function graphPointAt(view: any, vx: number, vy: number): { x: number; y: number } {
    const { panX, panY, zoom } = parseTransform(view._contentHost.getTransform());

    return { x: (vx - panX) / zoom, y: (vy - panY) / zoom };
}

/** Maps the viewport-centre point back to graph coordinates from the current transform. */
function centreGraphPoint(view: any, viewportWidth: number, viewportHeight: number): { x: number; y: number } {
    return graphPointAt(view, viewportWidth / 2, viewportHeight / 2);
}

let sink: RecordingDOMSink;

beforeEach(() => {
    sink = installTestDOM(CONFIG);
});

afterEach(() => {
    DOM.reset();
});

// MUST be the first describe block in this file, and its one test the only
// place a real dispatched DOM event (`.click()` / `Event.fireEvent`) is used
// for click/contextmenu. `Event`'s window-level base listener is installed
// once per event TYPE for the lifetime of this module and never re-armed on
// the fresh `DOM.sink` a later `installTestDOM()` call swaps in (see
// tests/component/MenuButton.test.ts's file-level comment, which documents
// the same constraint for `.click()`). `DiagramView.init()` registers all
// seven of its subtree listener types (including "contextmenu") in one call,
// the first time any view's element is forced in this file — so both the
// control-cluster click dispatch AND the contextmenu dispatch below must
// live in this same first test, on the same view, or a later test's fresh
// `DOM.sink` would silently get no listener at all. Every other test in this
// file drives the control buttons' registered handler fields, and
// `_handleContextMenu` directly, instead — unaffected by this constraint and
// how the rest of the codebase tests this kind of wiring.
describe('DiagramView — real DOM-dispatched wiring (behaviours 10, 19)', () => {
    it('a real click reaches each control button\'s viewport-motion method, and a real contextmenu reaches the node handler', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: Array<[DiagramNodeData, MouseEvent]> = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { contextmenu: (node, e) => fired.push([node, e]) } }) as any;

        await flush();
        view.setSize({ width: 1280, height: 800 });
        view.getElement(true);

        view._zoomInBtn.click();
        expect(view.getZoom()).toBeCloseTo(1.5, 5);

        view._zoomOutBtn.click();
        expect(view.getZoom()).toBeCloseTo(1, 5);

        view._fitBtn.click();
        expect(view.getZoom()).toBeCloseTo(Math.min(1280 / 160, 800 / 230), 5);

        view._resetBtn.click();
        expect(view.getZoom()).toBe(1);
        expect(view._contentHost.getTransform()).toBe('translate(560px, 285px) scale(1)');

        const nodeA = view._nodeComponents.get('a');
        const nodeHandle: Handle = nodeA.getElement(true);

        Event.fireEvent(nodeA, makeEvent(nodeHandle, 'contextmenu') as any);

        expect(fired).toHaveLength(1);
        expect(fired[0][0].id).toBe('a');

        // The "wheel" subtree listener must be registered { passive: false } so
        // _handleWheel's preventDefault() actually suppresses the page's native
        // scroll/zoom (see init()). RecordingDOMSink.addListener drops the
        // options it's given, so this isn't directly observable through a
        // recorded write — but Event's own conflict guard makes it indirectly
        // observable: having claimed "wheel" as passive: false (via the
        // getElement(true) above, which runs DiagramView's init()), a later
        // registration with a *different* passive setting throws, while a
        // matching one doesn't.
        const other = new Component();
        expect(() => Event.addSubtreeListener(other, 'wheel', { passive: true, handler: () => {} })).toThrow();
        expect(() => Event.addSubtreeListener(other, 'wheel', { passive: false, handler: () => {} })).not.toThrow();
    });
});

describe('DiagramView — layout application (U2)', () => {
    it('positions each node at the mapped coords and sizes the content host to the unscaled graph bounds', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        const nodeA = view._nodeComponents.get('a');
        const nodeB = view._nodeComponents.get('b');

        expect([nodeA.getX(), nodeA.getY()]).toEqual([10, 20]);
        expect([nodeB.getX(), nodeB.getY()]).toEqual([100, 200]);

        // The host box always equals the unscaled graph bounds — zoom lives
        // only in the transform's scale() factor (see applyTransformToHost).
        expect(view._contentHost.getPreferredSize()).toEqual({ width: 160, height: 230 });
    });
});

describe('DiagramView — edge style re-join (applyLayout)', () => {
    it('attaches the model edge\'s style to the route passed to the edge layer, joined by id', async () => {
        stubEngine = new StubEngine(fixedResult());

        const data: DiagramData = {
            nodes: [{ id: 'a' }, { id: 'b' }],
            edges: [{ id: 'e', source: 'a', target: 'b', style: { startMarker: 'oneOrMany', endMarker: 'one' } }],
        };

        const view = new StubDiagramView({ data }) as any;

        await flush();

        const drawn = view._edgeLayer._edges;

        expect(drawn).toHaveLength(1);
        expect(drawn[0].id).toBe('e');
        expect(drawn[0].style).toEqual({ startMarker: 'oneOrMany', endMarker: 'one' });
    });

    it('leaves a plain (no-style) model edge\'s route with no style', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        expect(view._edgeLayer._edges[0].style).toBeUndefined();
    });
});

describe('DiagramView — content host overflow (U2b)', () => {
    it('leaves the content host overflow visible (kept from the pre-transform pan model; no longer load-bearing ' +
       'now the host box always equals the unscaled graph bounds, so nodes never exceed it regardless of zoom)', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        expect(view._contentHost.getOverflowX()).toBe('visible');
        expect(view._contentHost.getOverflowY()).toBe('visible');
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

    it('a node double-click fires "activate" with the node data, without clearing selection', async () => {
        stubEngine = new StubEngine(fixedResult());

        const activated: DiagramNodeData[] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { activate: (node) => activated.push(node) } }) as any;

        await flush();

        const handle: Handle = view._nodeComponents.get('a').getElement(true);

        view._handleDoubleClick(makeEvent(handle, 'dblclick'));

        expect(activated).toHaveLength(1);
        expect(activated[0].id).toBe('a');
    });

    it('a double-click on empty canvas fires no "activate"', async () => {
        stubEngine = new StubEngine(fixedResult());

        const activated: DiagramNodeData[] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { activate: (node) => activated.push(node) } }) as any;

        await flush();

        // The view's own root element is not a node, so it resolves to no node.
        const empty: Handle = view.getElement(true);

        view._handleDoubleClick(makeEvent(empty, 'dblclick'));

        expect(activated).toHaveLength(0);
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

    it('two clicks on the same node fire "selection" once, not twice', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: DiagramNodeData[][] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { selection: (nodes) => fired.push(nodes) } }) as any;

        await flush();

        const handle: Handle = view._nodeComponents.get('a').getElement(true);

        view._handleClick(makeEvent(handle, 'click'));
        view._handleClick(makeEvent(handle, 'click'));

        expect(fired).toHaveLength(1);
    });

    it('a click on node A, then a click on node B, fires "selection" twice', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: DiagramNodeData[][] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { selection: (nodes) => fired.push(nodes) } }) as any;

        await flush();

        const handleA: Handle = view._nodeComponents.get('a').getElement(true);
        const handleB: Handle = view._nodeComponents.get('b').getElement(true);

        view._handleClick(makeEvent(handleA, 'click'));
        view._handleClick(makeEvent(handleB, 'click'));

        expect(fired).toHaveLength(2);
    });

    it('a click on empty canvas when nothing is selected does not fire', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: unknown[] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { selection: () => fired.push(1) } }) as any;

        await flush();

        const empty: Handle = view.getElement(true);

        view._handleClick(makeEvent(empty, 'click'));

        expect(fired).toHaveLength(0);
    });

    it('a click on node A, then a click on empty canvas, fires "selection" once (the clear)', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: DiagramNodeData[][] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { selection: (nodes) => fired.push(nodes) } }) as any;

        await flush();

        const handleA: Handle = view._nodeComponents.get('a').getElement(true);
        const empty: Handle = view.getElement(true);

        view._handleClick(makeEvent(handleA, 'click'));
        view._handleClick(makeEvent(empty, 'click'));

        expect(fired).toHaveLength(2);
        expect(fired[1]).toEqual([]);
    });

    it('a click reproducing what selectNode already selected does not emit', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: unknown[] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { selection: () => fired.push(1) } }) as any;

        await flush();

        view.selectNode('a');
        const handle: Handle = view._nodeComponents.get('a').getElement(true);

        view._handleClick(makeEvent(handle, 'click'));

        expect(fired).toHaveLength(0);
    });
});

describe('DiagramView — zoom + transform (U5, U6)', () => {
    it('renders the pan/zoom transform after layout at the default zoom (behaviour 1)', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        expect(view._contentHost.getTransform()).toBe('translate(0px, 0px) scale(1)');
    });

    it('clamps zoom to [minZoom, maxZoom], writing only the scale factor into the transform, ' +
       'and leaves the host box unscaled (behaviours 2, 3)', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        view.setZoom(10);

        expect(view.getZoom()).toBe(4);
        expect(view._contentHost.getTransform()).toBe('translate(0px, 0px) scale(4)');
        // The host is no longer resized per zoom — its box always matches the
        // unscaled graph bounds; only the transform's `scale()` carries the zoom.
        expect(view._contentHost.getPreferredSize()).toEqual({ width: 160, height: 230 });

        view.setZoom(0);

        expect(view.getZoom()).toBe(0.25);
        expect(view._contentHost.getTransform()).toBe('translate(0px, 0px) scale(0.25)');
        expect(view._contentHost.getPreferredSize()).toEqual({ width: 160, height: 230 });
    });

    it('resolves the class-default zoom of 1 through the folding getter (U6)', () => {
        stubEngine = new StubEngine(fixedResult());

        expect(new StubDiagramView().getZoom()).toBe(1);
    });

    it('rejects a non-finite zoom request rather than propagating NaN', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        view.setZoom(NaN);

        expect(view.getZoom()).toBe(1);
        expect(view._contentHost.getTransform()).toBe('translate(0px, 0px) scale(1)');
    });
});

describe('DiagramView — adaptive minimum zoom (behaviours 4, 5)', () => {
    it('leaves the floor at the configured minZoom for a small graph that already fits', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        view.setSize({ width: 1280, height: 800 });

        // fitZoom = min(1280/160, 800/230) ≈ 3.48, well above the configured
        // 0.25 floor, so the floor is untouched.
        view.setZoom(0);

        expect(view.getZoom()).toBe(0.25);
    });

    it('lowers the floor below the configured minZoom so a huge graph can reach its fit zoom', async () => {
        const hugeResult: DiagramLayoutResult = {
            nodes: [{ id: 'a', x: 0, y: 0, width: 10, height: 10 }],
            edges: [],
            width:  43900,
            height: 1000,
        };

        stubEngine = new StubEngine(hugeResult);

        const view = new StubDiagramView({ data: { nodes: [{ id: 'a' }], edges: [] } }) as any;

        await flush();
        view.setSize({ width: 1280, height: 800 });

        view.zoomToFit();

        expect(view.getZoom()).toBeCloseTo(1280 / 43900, 5);
    });
});

describe('DiagramView — zoomToFit centres the graph (behaviour 6)', () => {
    it('fits the graph to the smaller axis (clamped to maxZoom) and centres it in the viewport', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        view.setSize({ width: 1280, height: 800 });

        view.zoomToFit();

        const expectedZoom = Math.min(1280 / 160, 800 / 230);
        const { panX, panY, zoom } = parseTransform(view._contentHost.getTransform());

        expect(zoom).toBeCloseTo(expectedZoom, 5);
        expect(view.getZoom()).toBeCloseTo(expectedZoom, 5);
        expect(panX).toBeCloseTo((1280 - 160 * expectedZoom) / 2, 3);
        expect(panY).toBeCloseTo((800 - 230 * expectedZoom) / 2, 3);
    });

    it('is a no-op on an unsized view rather than writing a NaN zoom (the plan\'s own auto-fit ' +
       'recipe — view.on("layout", () => view.zoomToFit()) — can fire before the view is sized)', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        // Deliberately skip setSize — getWidth()/getHeight() are NaN, so
        // zoomX/zoomY would be NaN without setZoom's guard.

        view.zoomToFit();

        expect(view.getZoom()).toBe(1);
        expect(view._contentHost.getTransform()).toBe('translate(0px, 0px) scale(1)');
    });
});

describe('DiagramView — resetView (behaviour 7)', () => {
    it('resets to the default zoom and re-centres the graph', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        view.setSize({ width: 1280, height: 800 });

        view.zoomToFit();
        view.resetView();

        expect(view.getZoom()).toBe(1);
        expect(view._contentHost.getTransform()).toBe('translate(560px, 285px) scale(1)');
    });

    it('is a no-op on an unsized view rather than writing a NaN pan', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        view.resetView();

        expect(view._contentHost.getTransform()).toBe('translate(0px, 0px) scale(1)');
    });

    it('recovers a graph panned far off-screen (behaviour 20)', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        view.setSize({ width: 1280, height: 800 });

        const empty: Handle = view.getElement(true);

        // Drag the graph thousands of pixels off-screen.
        view._handlePointerDown(makeEvent(empty, 'pointerdown', { button: 0, clientX: 0, clientY: 0 }));
        view._handlePointerMove(makeEvent(empty, 'pointermove', { clientX: -5000, clientY: -5000, buttons: 1 }));
        view._handlePointerUp();

        expect(view._contentHost.getTransform()).toBe('translate(-5000px, -5000px) scale(1)');

        view.resetView();

        expect(view._contentHost.getTransform()).toBe('translate(560px, 285px) scale(1)');
    });
});

describe('DiagramView — initial view is centred, matching resetView', () => {
    it('centres the graph on the first layout instead of showing its top-left corner', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        // Sized before the async layout lands, the common case once mounted.
        view.setSize({ width: 1280, height: 800 });

        await flush();

        // Exactly where resetView() puts it: (1280−160)/2, (800−230)/2.
        expect(view._contentHost.getTransform()).toBe('translate(560px, 285px) scale(1)');
    });

    it('keeps a consumer-configured zoom rather than resetting it to the default', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph(), zoom: 2 }) as any;

        view.setSize({ width: 1280, height: 800 });

        await flush();

        // Centred *at zoom 2* — unlike resetView, the initial centring never
        // overrides an explicitly configured zoom.
        expect(view.getZoom()).toBe(2);
        expect(view._contentHost.getTransform()).toBe('translate(480px, 170px) scale(2)');
    });

    it('defers the centring when the layout lands before the view has been sized', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        // No setSize: the layout lands on an unsized view, where centring would
        // otherwise be a no-op (getWidth() is NaN) and leave it at the corner.
        await flush();

        expect(view._contentHost.getTransform()).toBe('translate(0px, 0px) scale(1)');

        // Now mount + size it, the way a host does on its first layout pass.
        vi.spyOn(DOM.source, 'isConnected').mockReturnValue(true);
        view.getElement(true);
        view.setSize({ width: 1280, height: 800 });
        view.doLayout();

        expect(view._contentHost.getTransform()).toBe('translate(560px, 285px) scale(1)');

        vi.restoreAllMocks();
    });

    it('does not lose the centring when a layout pass runs while the view is still unsized', async () => {
        stubEngine = new StubEngine(fixedResult());

        // Mounted (as in a browser) but not yet sized — the ordering that made
        // the first render land top-left: the async ELK result and a layout
        // pass both arrive before the host has given the view a size.
        vi.spyOn(DOM.source, 'isConnected').mockReturnValue(true);

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        view.getElement(true);

        await flush();

        // A layout pass while still unsized must not consume the pending
        // centring — centring here is a no-op, so the attempt has to be retried.
        view.doLayout();

        expect(view._contentHost.getTransform()).toBe('translate(0px, 0px) scale(1)');

        view.setSize({ width: 1280, height: 800 });
        view.doLayout();

        expect(view._contentHost.getTransform()).toBe('translate(560px, 285px) scale(1)');

        vi.restoreAllMocks();
    });

    it('centres only the first layout — a later setData leaves the current pan alone', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        // Stand in for a pan the user has dragged to since the first render.
        view._panX = 99;
        view._panY = 77;
        view.applyTransformToHost();

        view.setData(simpleGraph());
        await flush();

        expect(view._contentHost.getTransform()).toBe('translate(99px, 77px) scale(1)');
    });
});

describe('DiagramView — a viewport resize keeps the centre graph point fixed', () => {
    /** A rendered, sized, laid-out view whose initial centring has landed. */
    async function sizedView(width: number, height: number): Promise<any> {
        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        view.getElement(true);
        view.setSize({ width, height });
        await flush();
        view.doLayout();

        return view;
    }

    it('keeps what the user is looking at centred when the viewport grows', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = await sizedView(1280, 800);
        const before = graphPointAt(view, 1280 / 2, 800 / 2);

        view.setSize({ width: 1600, height: 1000 });
        view.doLayout();

        const after = graphPointAt(view, 1600 / 2, 1000 / 2);

        expect(after.x).toBeCloseTo(before.x, 5);
        expect(after.y).toBeCloseTo(before.y, 5);
    });

    it('keeps it centred when the viewport shrinks', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = await sizedView(1280, 800);
        const before = graphPointAt(view, 1280 / 2, 800 / 2);

        view.setSize({ width: 700, height: 400 });
        view.doLayout();

        const after = graphPointAt(view, 700 / 2, 400 / 2);

        expect(after.x).toBeCloseTo(before.x, 5);
        expect(after.y).toBeCloseTo(before.y, 5);
    });

    it('anchors the centre the user actually panned/zoomed to, not the graph centre', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = await sizedView(1280, 800);

        // Move somewhere deliberately off-centre, at a non-default zoom.
        view.setZoom(2.5);
        view._panX = -320;
        view._panY = 140;
        view.applyTransformToHost();

        const before = graphPointAt(view, 1280 / 2, 800 / 2);

        view.setSize({ width: 900, height: 1100 });
        view.doLayout();

        const after = graphPointAt(view, 900 / 2, 1100 / 2);

        expect(after.x).toBeCloseTo(before.x, 5);
        expect(after.y).toBeCloseTo(before.y, 5);
        // The zoom is untouched by a resize.
        expect(view.getZoom()).toBe(2.5);
    });

    it('does not shift the pan when a layout pass leaves the size unchanged', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = await sizedView(1280, 800);
        const settled = view._contentHost.getTransform();

        view.doLayout();
        view.doLayout();

        expect(view._contentHost.getTransform()).toBe(settled);
    });
});

describe('DiagramView — zoomIn / zoomOut (behaviour 8)', () => {
    it('zoomIn steps the zoom up by the configured factor, keeping the viewport-centre graph point fixed', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        view.setSize({ width: 1280, height: 800 });

        const before = centreGraphPoint(view, 1280, 800);

        view.zoomIn();

        expect(view.getZoom()).toBeCloseTo(1.5, 5);
        const after = centreGraphPoint(view, 1280, 800);
        expect(after.x).toBeCloseTo(before.x, 5);
        expect(after.y).toBeCloseTo(before.y, 5);
    });

    it('zoomOut steps the zoom down by the configured factor, keeping the viewport-centre graph point fixed', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        view.setSize({ width: 1280, height: 800 });

        const before = centreGraphPoint(view, 1280, 800);

        view.zoomOut();

        expect(view.getZoom()).toBeCloseTo(1 / 1.5, 5);
        const after = centreGraphPoint(view, 1280, 800);
        expect(after.x).toBeCloseTo(before.x, 5);
        expect(after.y).toBeCloseTo(before.y, 5);
    });

    it('is a no-op on an unsized view rather than writing a NaN pan', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        view.zoomIn();

        expect(view.getZoom()).toBe(1);
        expect(view._contentHost.getTransform()).toBe('translate(0px, 0px) scale(1)');
    });
});

describe('DiagramView — revealNode centres via the transform (behaviour 9)', () => {
    it('sets pan so the node centre maps to the viewport centre, writing no scroll offsets', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        view.setSize({ width: 1280, height: 800 });

        // The offline harness swallows requestAnimationFrame (see
        // TestDOM.RecordingDOMSink.requestAnimationFrame), so `scheduleLayout`'s
        // deferred pass never runs on its own; force the content host's
        // Absolute layout to commit each node's real size from its preferred
        // size before revealNode reads getWidth()/getHeight() on node 'a'.
        view._contentHost.doLayout();

        sink.writes.length = 0;

        view.revealNode('a');

        // Node 'a' is at (10, 20, 60, 30) → centre (40, 35).
        expect(view._contentHost.getTransform()).toBe('translate(600px, 365px) scale(1)');

        const scrollWrites = sink.writes.filter((w) =>
            w.op === 'apply' && ((w.args[1] as any).scrollLeft !== undefined || (w.args[1] as any).scrollTop !== undefined));
        expect(scrollWrites).toHaveLength(0);
    });

    it('is a no-op on an unsized view rather than writing a NaN pan', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        // Deliberately skip setSize/doLayout — the view is unsized and node
        // 'a' has no committed real size, either of which would otherwise
        // poison the pan with NaN (see the fixed regression this pins).

        view.revealNode('a');

        expect(view._contentHost.getTransform()).toBe('translate(0px, 0px) scale(1)');
    });
});

describe('DiagramView — "contextmenu" node event (behaviours 10, 11)', () => {
    it('fires "contextmenu" with the node data and prevents the default menu on a node hit', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: Array<[DiagramNodeData, MouseEvent]> = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { contextmenu: (node, e) => fired.push([node, e]) } }) as any;

        await flush();

        const handle: Handle = view._nodeComponents.get('a').getElement(true);
        const event = makeEvent(handle, 'contextmenu') as any;

        // `_handleContextMenu` claims the event by RETURNING `{ prevent: true }`
        // rather than calling `e.preventDefault()` itself — the real dispatcher
        // applies that disposition, which this direct call bypasses.
        const result: Event.ListenerResult = view._handleContextMenu(event);

        expect(fired).toHaveLength(1);
        expect(fired[0][0].id).toBe('a');
        expect(typeof result === 'object' && result?.prevent).toBe(true);
    });

    it('fires no "contextmenu" and does not prevent default on empty canvas', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: unknown[] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { contextmenu: () => fired.push(1) } }) as any;

        await flush();

        const empty: Handle = view.getElement(true);
        const event = makeEvent(empty, 'contextmenu') as any;

        const result: Event.ListenerResult = view._handleContextMenu(event);

        expect(fired).toHaveLength(0);
        expect(typeof result === 'object' && result?.prevent).toBeFalsy();
    });
});

describe('DiagramView — control cluster hit guard (behaviours 12, 13)', () => {
    it('a click on a control button does not change the selection', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        view.selectNode('a');
        // Force the whole subtree to render — a real click on a control button
        // implies the cluster is already live in the DOM, which the containment
        // check in isControlsTarget relies on (unlike nodeIdAt's self-equality
        // check, this checks an ancestor/descendant relationship).
        view.getElement(true);
        const buttonHandle: Handle = view._zoomInBtn.getElement(true);

        view._handleClick(makeEvent(buttonHandle, 'click'));

        expect(view.getSelection().map((n: DiagramNodeData) => n.id)).toEqual(['a']);
    });

    it('a pointerdown on a control button does not start a pan', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        view.getElement(true);
        const buttonHandle: Handle = view._zoomInBtn.getElement(true);

        view._handlePointerDown(makeEvent(buttonHandle, 'pointerdown', { button: 0 }));

        expect(view._panning).toBe(false);
    });
});

describe('DiagramView — controls option default (behaviour 14)', () => {
    it('defaults to visible controls, honouring an explicit controls: false', () => {
        stubEngine = new StubEngine(fixedResult());

        expect(new StubDiagramView().isControlsVisible()).toBe(true);
        expect(new StubDiagramView({ controls: false }).isControlsVisible()).toBe(false);

        // The option getter alone doesn't prove the cluster itself is hidden —
        // assert the constructor's own dispatch actually hid it.
        expect((new StubDiagramView({ controls: false }) as any)._controls.isVisible()).toBe(false);
    });

    it('setControlsVisible actually toggles the cluster component, not just the cached option', () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView() as any;

        expect(view._controls.isVisible()).not.toBe(false);

        view.setControlsVisible(false);
        expect(view._controls.isVisible()).toBe(false);

        view.setControlsVisible(true);
        expect(view._controls.isVisible()).not.toBe(false);
    });
});

describe('DiagramView — control cluster (behaviour 19)', () => {
    it('builds four glyph-only buttons with accessible labels mirroring VideoPlayer\'s pattern', () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView() as any;

        expect(view._controls.getComponents()).toHaveLength(4);
        expect(view._zoomInBtn.getAria().getLabel()).toBe('Zoom in');
        expect(view._zoomOutBtn.getAria().getLabel()).toBe('Zoom out');
        expect(view._fitBtn.getAria().getLabel()).toBe('Fit to view');
        expect(view._resetBtn.getAria().getLabel()).toBe('Reset view');
        expect(view._zoomInBtn.getGlyph()?.getGlyphName()).toBe('plus');
        expect(view._zoomOutBtn.getGlyph()?.getGlyphName()).toBe('minus');
        expect(view._fitBtn.getGlyph()?.getGlyphName()).toBe('expand');
        expect(view._resetBtn.getGlyph()?.getGlyphName()).toBe('crosshairs');
    });

    // Real click-dispatch coverage of each button's "action" wiring lives in
    // the file-first "control cluster button wiring" describe block above
    // (Button.click() cannot be used reliably anywhere else in this file —
    // see that block's comment); zoomIn/zoomOut/zoomToFit/resetView's own
    // math is covered by their dedicated describe blocks.

    it('pins the cluster to the bottom-right corner, inset by the controls margin', () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView() as any;

        view.getElement(true);
        view.setSize({ width: 1280, height: 800 });
        view.clearInsets();
        view.doLayout();

        // Anchor's { right, bottom } constraint resolves start+extent = inner - far,
        // regardless of the cluster's own (VBox-derived) width/height.
        expect(view._controls.getX() + view._controls.getWidth()).toBe(1280 - 12);
        expect(view._controls.getY() + view._controls.getHeight()).toBe(800 - 12);
    });

    // Guards against FloatingPanel's Panel ancestry silently reintroducing
    // Panel's own default 4px insets (Panel.ts's `_defaultPanelOptions`),
    // which would shift the cluster's buttons in from its edge — FloatingPanel
    // must keep its own zero-inset default for this refactor to be
    // byte-identical to the pre-refactor plain-Component cluster.
    it('keeps the controls cluster at zero insets after the FloatingPanel refactor', () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView() as any;
        const insets = view._controls.getInsets();

        expect([insets.getTop(), insets.getRight(), insets.getBottom(), insets.getLeft()]).toEqual([0, 0, 0, 0]);
    });
});

describe('DiagramView — the cursor promises what a drag will do', () => {
    it('leaves the content host cursor-transparent so the viewport\'s grab shows through it', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        // Every Component stamps its own cursor (ComponentDefaults: "default"),
        // and the content host is an invisible box spanning the whole graph
        // bounds — left at the default it paints an arrow over the canvas and
        // hides the viewport's grab/grabbing.
        expect(view._contentHost.getCursor()).toBe('inherit');
    });

    it('gives a container node the same pointer cursor as a leaf node, since both are selectable', async () => {
        stubEngine = new StubEngine(compoundResult());

        const view = new StubDiagramView({ data: compoundGraph() }) as any;

        await flush();

        expect(view._nodeComponents.get('schema:public').getCursor()).toBe('pointer');
        expect(view._nodeComponents.get('public.users').getCursor()).toBe('pointer');
    });

    it('does not start a pan on a leaf node — the pointer cursor there promises a click, not a drag', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        const nodeHandle: Handle = view._nodeComponents.get('a').getElement(true);

        view._handlePointerDown(makeEvent(nodeHandle, 'pointerdown', { button: 0, clientX: 100, clientY: 100 }));

        expect(view._panning).toBe(false);
        expect(view.getCursor()).toBe('grab');
    });

    it('does not start a pan on a container node either', async () => {
        stubEngine = new StubEngine(compoundResult());

        const view = new StubDiagramView({ data: compoundGraph() }) as any;

        await flush();

        const groupHandle: Handle = view._nodeComponents.get('schema:public').getElement(true);

        view._handlePointerDown(makeEvent(groupHandle, 'pointerdown', { button: 0, clientX: 100, clientY: 100 }));

        expect(view._panning).toBe(false);
    });

    it('still pans from empty canvas', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        const empty: Handle = view.getElement(true);

        view._handlePointerDown(makeEvent(empty, 'pointerdown', { button: 0, clientX: 100, clientY: 100 }));

        expect(view._panning).toBe(true);
        expect(view.getCursor()).toBe('grabbing');
    });
});

describe('DiagramView — free pan drag + grab/grabbing cursor (behaviours 16, 17)', () => {
    it('shows "grab" on an idle view', () => {
        stubEngine = new StubEngine(fixedResult());

        expect(new StubDiagramView().getCursor()).toBe('grab');
    });

    it('pans the content host by the pointer delta, unbounded into negative territory, ' +
       'switching to "grabbing" for the drag and back to "grab" on release', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        const empty: Handle = view.getElement(true);

        view._handlePointerDown(makeEvent(empty, 'pointerdown', { button: 0, clientX: 100, clientY: 100 }));

        expect(view._panning).toBe(true);
        expect(view.getCursor()).toBe('grabbing');

        // Drag up and to the left, past the origin — pan is unbounded and goes negative.
        view._handlePointerMove(makeEvent(empty, 'pointermove', { clientX: 40, clientY: 30, buttons: 1 }));

        expect(view._contentHost.getTransform()).toBe('translate(-60px, -70px) scale(1)');

        view._handlePointerUp();

        expect(view._panning).toBe(false);
        expect(view.getCursor()).toBe('grab');
    });

    it('ends the pan and restores "grab" when pointermove reports the button already released', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        const empty: Handle = view.getElement(true);

        view._handlePointerDown(makeEvent(empty, 'pointerdown', { button: 0, clientX: 100, clientY: 100 }));
        view._handlePointerMove(makeEvent(empty, 'pointermove', { clientX: 40, clientY: 30, buttons: 0 }));

        expect(view._panning).toBe(false);
        expect(view.getCursor()).toBe('grab');
    });
});

describe('DiagramView — a drag never changes the selection', () => {
    it('a pan that starts and ends on empty canvas leaves an existing selection and fires no "selection"', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: unknown[] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { selection: () => fired.push(1) } }) as any;

        await flush();
        view.selectNode('a');

        const empty: Handle = view.getElement(true);

        view._handlePointerDown(makeEvent(empty, 'pointerdown', { button: 0, clientX: 100, clientY: 100 }));
        view._handlePointerMove(makeEvent(empty, 'pointermove', { clientX: 140, clientY: 130, buttons: 1 }));
        view._handleClick(makeEvent(empty, 'click'));

        expect(view.getSelection().map((n: DiagramNodeData) => n.id)).toEqual(['a']);
        expect(fired).toHaveLength(0);
    });

    it('a drag that starts on a node and ends on empty canvas does not change the selection', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: unknown[] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { selection: () => fired.push(1) } }) as any;

        await flush();
        view.selectNode('a');

        const nodeHandle: Handle = view._nodeComponents.get('a').getElement(true);
        const empty: Handle = view.getElement(true);

        view._handlePointerDown(makeEvent(nodeHandle, 'pointerdown', { button: 0, clientX: 100, clientY: 100 }));
        view._handlePointerMove(makeEvent(empty, 'pointermove', { clientX: 140, clientY: 130, buttons: 1 }));
        // The browser fires "click" on the nearest common ancestor of press and
        // release — here the view root — regardless of which target this
        // synthetic event names.
        view._handleClick(makeEvent(empty, 'click'));

        expect(view.getSelection().map((n: DiagramNodeData) => n.id)).toEqual(['a']);
        expect(fired).toHaveLength(0);
    });

    it('a press-and-release within the 4px slop still clicks: the selection clears and "selection" fires', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: unknown[][] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { selection: (nodes: DiagramNodeData[]) => fired.push(nodes as unknown as unknown[]) } }) as any;

        await flush();
        view.selectNode('a');

        const empty: Handle = view.getElement(true);

        view._handlePointerDown(makeEvent(empty, 'pointerdown', { button: 0, clientX: 100, clientY: 100 }));
        view._handlePointerMove(makeEvent(empty, 'pointermove', { clientX: 102, clientY: 101, buttons: 1 }));
        view._handleClick(makeEvent(empty, 'click'));

        expect(view.getSelection()).toEqual([]);
        expect(fired).toHaveLength(1);
        expect(fired[0]).toEqual([]);
    });

    it('_handleClick with no preceding _handlePointerDown still selects normally (the guard defaults to "not moved")', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        const handle: Handle = view._nodeComponents.get('a').getElement(true);

        view._handleClick(makeEvent(handle, 'click'));

        expect(view.getSelection().map((n: DiagramNodeData) => n.id)).toEqual(['a']);
    });

    it('an ambient pointermove with no button held (hover, before any press) does not arm the guard', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        const empty: Handle = view.getElement(true);
        const handle: Handle = view._nodeComponents.get('a').getElement(true);

        // A move far from the (0, 0) default press point, with no button
        // held — ordinary mouse travel before the user ever presses down.
        view._handlePointerMove(makeEvent(empty, 'pointermove', { clientX: 900, clientY: 700, buttons: 0 }));
        view._handleClick(makeEvent(handle, 'click'));

        expect(view.getSelection().map((n: DiagramNodeData) => n.id)).toEqual(['a']);
    });

    it('a second press resets the guard: a fresh unmoved press-and-click still clears the selection', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        view.selectNode('a');

        const empty: Handle = view.getElement(true);

        // First: a drag that must not clear the selection.
        view._handlePointerDown(makeEvent(empty, 'pointerdown', { button: 0, clientX: 100, clientY: 100 }));
        view._handlePointerMove(makeEvent(empty, 'pointermove', { clientX: 140, clientY: 130, buttons: 1 }));
        view._handleClick(makeEvent(empty, 'click'));

        expect(view.getSelection().map((n: DiagramNodeData) => n.id)).toEqual(['a']);

        // Second: a fresh press with no movement — the sticky flag from the
        // first drag must not still be set.
        view._handlePointerDown(makeEvent(empty, 'pointerdown', { button: 0, clientX: 200, clientY: 200 }));
        view._handleClick(makeEvent(empty, 'click'));

        expect(view.getSelection()).toEqual([]);
    });
});

describe('DiagramView — wheel-zoom about the pointer (behaviour 18)', () => {
    it('zooms in toward the pointer, keeping the graph point under it fixed', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        view.setSize({ width: 1280, height: 800 });

        const empty: Handle = view.getElement(true);
        const pointerX = 200;
        const pointerY = 150;
        const before = graphPointAt(view, pointerX, pointerY);

        view._handleWheel(makeEvent(empty, 'wheel', { clientX: pointerX, clientY: pointerY, deltaY: -1 }));

        expect(view.getZoom()).toBeCloseTo(1.1, 5);
        const after = graphPointAt(view, pointerX, pointerY);
        expect(after.x).toBeCloseTo(before.x, 5);
        expect(after.y).toBeCloseTo(before.y, 5);
    });

    it('zooms out away from the pointer, keeping the graph point under it fixed', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        view.setSize({ width: 1280, height: 800 });

        const empty: Handle = view.getElement(true);
        const pointerX = 900;
        const pointerY = 500;
        const before = graphPointAt(view, pointerX, pointerY);

        view._handleWheel(makeEvent(empty, 'wheel', { clientX: pointerX, clientY: pointerY, deltaY: 1 }));

        expect(view.getZoom()).toBeCloseTo(1 / 1.1, 5);
        const after = graphPointAt(view, pointerX, pointerY);
        expect(after.x).toBeCloseTo(before.x, 5);
        expect(after.y).toBeCloseTo(before.y, 5);
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

describe('DiagramView — hidden until placed', () => {
    it('mounts new node components hidden in the incoming set, revealing them only once laid out', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        expect(view._incomingComponents.size).toBe(2);
        expect(view._nodeComponents.size).toBe(0);

        for (const component of view._incomingComponents.values()) {
            expect(component.isVisible()).toBe(false);
        }

        stubEngine.resolveDeferred(0, fixedResult());
        await flush();

        expect(view._nodeComponents.size).toBe(2);
        expect(view._incomingComponents.size).toBe(0);

        for (const component of view._nodeComponents.values()) {
            expect(component.isVisible()).toBe(true);
        }

        expect(view._nodeComponents.get('a').getX()).toBe(10);
        expect(view._nodeComponents.get('a').getY()).toBe(20);
    });
});

describe('DiagramView — a re-layout keeps the previous graph painted', () => {
    it('leaves the first graph shown and visible while the second lays out hidden alongside it', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView() as any;

        const firstData: DiagramData = { nodes: [{ id: 'a' }], edges: [] };
        const secondData: DiagramData = { nodes: [{ id: 'z' }], edges: [] };
        const firstResult: DiagramLayoutResult = { nodes: [{ id: 'a', x: 1, y: 1, width: 10, height: 10 }], edges: [], width: 10, height: 10 };
        const secondResult: DiagramLayoutResult = { nodes: [{ id: 'z', x: 9, y: 9, width: 20, height: 20 }], edges: [], width: 20, height: 20 };

        view.setData(firstData);   // generation 1 → deferred[0]
        stubEngine.resolveDeferred(0, firstResult);
        await flush();

        expect(view._nodeComponents.has('a')).toBe(true);

        view.setData(secondData);  // generation 2 → deferred[1]; first graph must stay shown

        expect(view._nodeComponents.has('a')).toBe(true);
        expect(view._nodeComponents.get('a').isVisible()).toBe(true);
        expect(view._incomingComponents.has('z')).toBe(true);
        expect(view._incomingComponents.get('z').isVisible()).toBe(false);

        stubEngine.resolveDeferred(1, secondResult);
        await flush();

        expect([...view._nodeComponents.keys()]).toEqual(['z']);
    });
});

describe('DiagramView — layout failure leaves whatever was already shown', () => {
    it('a failed first layout leaves both sets empty', async () => {
        stubEngine = new StubEngine(fixedResult(), 'reject');

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        expect(view._nodeComponents.size).toBe(0);
        expect(view._incomingComponents.size).toBe(0);
        expect(view.getSelection()).toEqual([]);
    });

    it('a failed re-layout after a settled first one leaves the first graph shown', async () => {
        let call = 0;

        // A custom stub (mirroring the z-index-reset test above) since a
        // single StubEngine instance can only be all-resolve, all-reject, or
        // all-defer — this needs the first call to succeed and the second
        // to fail.
        stubEngine = {
            layout: (): Promise<DiagramLayoutResult> => {
                call += 1;

                return call === 1 ? Promise.resolve(fixedResult()) : Promise.reject(new Error('elkjs unavailable'));
            },
            dispose: () => {},
        } as unknown as StubEngine;

        const view = new StubDiagramView({ data: simpleGraph() }) as any;
        await flush();

        expect(view._nodeComponents.size).toBe(2);

        view.setData(simpleGraph());
        await flush();

        expect(view._nodeComponents.size).toBe(2);
        expect(view._incomingComponents.size).toBe(0);
    });
});

describe('DiagramView — whenLaidOut()', () => {
    it('resolves immediately on a view with no data ever set', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView() as any;
        const resolved = vi.fn();

        view.whenLaidOut().then(resolved);
        await flush();

        expect(resolved).toHaveBeenCalledTimes(1);
    });

    it('resolves once a layout in flight delivers its result', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView({ data: simpleGraph() }) as any;
        const resolved = vi.fn();

        view.whenLaidOut().then(resolved);
        await flush();

        expect(resolved).not.toHaveBeenCalled();

        stubEngine.resolveDeferred(0, fixedResult());
        await flush();

        expect(resolved).toHaveBeenCalledTimes(1);
    });

    it('resolves, not rejects, when the in-flight layout fails', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView({ data: simpleGraph() }) as any;
        const resolved = vi.fn();
        const rejected = vi.fn();

        view.whenLaidOut().then(resolved, rejected);

        stubEngine.rejectDeferred(0, new Error('elkjs unavailable'));
        await flush();

        expect(resolved).toHaveBeenCalledTimes(1);
        expect(rejected).not.toHaveBeenCalled();
    });

    it('resolves when the view is disposed mid-pass and the result never arrives', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView({ data: simpleGraph() }) as any;
        const resolved = vi.fn();

        view.whenLaidOut().then(resolved);

        view.dispose();
        await flush();

        expect(resolved).toHaveBeenCalledTimes(1);
    });

    it('shares one promise across two setData calls before either lands, resolved by the second pass', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView() as any;

        view.setData({ nodes: [{ id: 'a' }], edges: [] });   // generation 1 → deferred[0]
        const first = view.whenLaidOut();

        view.setData({ nodes: [{ id: 'z' }], edges: [] });   // generation 2 → deferred[1]
        const second = view.whenLaidOut();

        expect(second).toBe(first);

        const resolved = vi.fn();
        first.then(resolved);

        stubEngine.resolveDeferred(1, { nodes: [{ id: 'z', x: 9, y: 9, width: 20, height: 20 }], edges: [], width: 20, height: 20 });
        await flush();

        expect(resolved).toHaveBeenCalledTimes(1);
    });
});

describe('DiagramView — initialFocusNode / focusNode', () => {
    it('centres the named node instead of the graph bounds, when sized before the layout lands', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph(), initialFocusNode: 'a' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        // Node 'a' is at (10, 20, 60, 30) → centre (40, 35).
        expect(view._contentHost.getTransform()).toBe('translate(600px, 365px) scale(1)');
    });

    it('retries the named node\'s centring once the view is sized, when the layout lands first', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph(), initialFocusNode: 'a' }) as any;

        // No setSize: the layout lands on an unsized view — the same retry
        // tryInitialCentre already performs for the bounds-centring case.
        await flush();

        expect(view._contentHost.getTransform()).toBe('translate(0px, 0px) scale(1)');

        vi.spyOn(DOM.source, 'isConnected').mockReturnValue(true);
        view.getElement(true);
        view.setSize({ width: 1280, height: 800 });
        view.doLayout();

        expect(view._contentHost.getTransform()).toBe('translate(600px, 365px) scale(1)');

        vi.restoreAllMocks();
    });

    it('falls back to the graph bounds when the focus id names no node in the graph', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph(), initialFocusNode: 'nope' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        expect(view._contentHost.getTransform()).toBe('translate(560px, 285px) scale(1)');
    });

    it('centres the graph bounds, unchanged, when no initialFocusNode is configured', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        expect(view._contentHost.getTransform()).toBe('translate(560px, 285px) scale(1)');
    });

    it('is one-shot: a later setData does not re-yank a pan the user has since dragged to', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph(), initialFocusNode: 'a' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        expect(view._contentHost.getTransform()).toBe('translate(600px, 365px) scale(1)');

        view._panX = 99;
        view._panY = 77;
        view.applyTransformToHost();

        view.setData(simpleGraph());
        await flush();

        expect(view._contentHost.getTransform()).toBe('translate(99px, 77px) scale(1)');
    });

    it('focusNode centres a different node on a settled, sized view', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        view.focusNode('b');

        // Node 'b' is at (100, 200, 60, 30) → centre (130, 215).
        expect(view._contentHost.getTransform()).toBe('translate(510px, 185px) scale(1)');
    });

    it('focusNode on an unsized view writes nothing, retried once the view is sized', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        view.focusNode('a');

        expect(view._contentHost.getTransform()).toBe('translate(0px, 0px) scale(1)');

        vi.spyOn(DOM.source, 'isConnected').mockReturnValue(true);
        view.getElement(true);
        view.setSize({ width: 1280, height: 800 });
        view.doLayout();

        expect(view._contentHost.getTransform()).toBe('translate(600px, 365px) scale(1)');

        vi.restoreAllMocks();
    });
});

describe('DiagramEdgeLayer — edge routing (U8)', () => {
    it('creates two paths (visible + invisible hit path) per routed edge and clears both on re-setEdges', () => {
        const layer = new _DiagramEdgeLayer();

        layer.getElement(true);  // render the <svg> + defs/marker/arrow
        sink.writes.length = 0;

        layer.setEdges([
            { id: 'e1', sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 10 } }] },
            { id: 'e2', sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 5, y: 5 } }] },
        ]);

        const created = sink.writes.filter((w) => w.op === 'createElementNS' && w.args[1] === 'path').length;
        expect(created).toBe(4);

        sink.writes.length = 0;

        layer.setEdges([{ id: 'e1', sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } }] }]);

        const removed = sink.writes.filter((w) => w.op === 'removeChild').length;
        const recreated = sink.writes.filter((w) => w.op === 'createElementNS' && w.args[1] === 'path').length;

        expect(removed).toBe(4);
        expect(recreated).toBe(2);
    });
});

describe('DiagramView — option routing (U9, extended by behaviour 15)', () => {
    it('routes every option to its setter and wires the listeners bag, including controls and contextmenu', async () => {
        stubEngine = new StubEngine(fixedResult());

        const layoutFired: number[] = [];
        const customNodes: DiagramNodeData[] = [];
        const contextMenuFired: DiagramNodeData[] = [];
        const edgehoverFired: unknown[][] = [];
        const edgeleaveFired: number[] = [];

        const view = new StubDiagramView({
            data:          simpleGraph(),
            layoutOptions: { 'elk.algorithm': 'layered' },
            minZoom:       0.5,
            maxZoom:       8,
            zoom:          2,
            controls:      false,
            nodeRenderer:  (n) => { customNodes.push(n); return new Component({ preferredSize: { width: 30, height: 20 } }); },
            listeners:     {
                layout: () => layoutFired.push(1),
                contextmenu: (n) => contextMenuFired.push(n),
                edgehover: (edges) => edgehoverFired.push(edges),
                edgeleave: () => edgeleaveFired.push(1),
            },
        }) as any;

        await flush();
        view.getElement(true);

        expect(view.getZoom()).toBe(2);
        expect(view.getData()).toEqual(simpleGraph());
        expect(stubEngine.lastArgs!.defaults).toEqual({ 'elk.algorithm': 'layered' });
        expect(customNodes.map((n) => n.id)).toEqual(['a', 'b']);
        expect(layoutFired).toHaveLength(1);
        expect(view.isControlsVisible()).toBe(false);

        const handle: Handle = view._nodeComponents.get('a').getElement(true);
        const event = makeEvent(handle, 'contextmenu') as any;
        event.preventDefault = () => {};
        view._handleContextMenu(event);
        expect(contextMenuFired.map((n) => n.id)).toEqual(['a']);

        // zoom: 2 above, pan (0,0) (the view is never sized, so the initial
        // centring no-ops) — the route's midpoint (85,125) is at client (170,250).
        const hitHandle: Handle = view._edgeLayer._drawn[0].hit;
        view._handleEdgeMouseMove(makeEvent(hitHandle, 'mousemove', { clientX: 170, clientY: 250 }));
        view._handleEdgeMouseOut(makeEvent(hitHandle, 'mouseout'));

        expect(edgehoverFired).toHaveLength(1);
        expect(edgeleaveFired).toHaveLength(1);
    });
});

describe('DiagramView — graceful ELK-absent (U10)', () => {
    it('does not throw synchronously and leaves the view empty when layout rejects', async () => {
        stubEngine = new StubEngine(fixedResult(), 'reject');

        const view = new StubDiagramView() as any;

        expect(() => view.setData(simpleGraph())).not.toThrow();

        await flush();

        expect(view._nodeComponents.size).toBe(0);
        expect(view._incomingComponents.size).toBe(0);
        expect(view.getSelection()).toEqual([]);
    });
});

/** A graph whose sole edge carries a `data` payload, for hover-passthrough assertions. */
function edgeHoverGraph(): DiagramData {
    return {
        nodes: [{ id: 'a', label: 'Hero' }, { id: 'b', label: 'World' }],
        edges: [{ id: 'e', source: 'a', target: 'b', data: { note: 'fk' } }],
    };
}

describe('DiagramView — setEdgeEmphasis / getEdgeEmphasis forward to the layer', () => {
    it('reaches the layer and reads back the same value', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        view.setEdgeEmphasis(['e']);

        expect(view._edgeLayer.getEdgeEmphasis()).toEqual(['e']);
        expect(view.getEdgeEmphasis()).toEqual(['e']);
    });
});

describe('DiagramView — setNodeEmphasis / getNodeEmphasis', () => {
    it('dims every node component outside the given set, leaving the named ones at full opacity', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        view.setNodeEmphasis(['a']);

        expect(view._nodeComponents.get('a').getOpacity()).toBeNull();
        expect(view._nodeComponents.get('b').getOpacity()).toBe(0.35);
    });

    it('setNodeEmphasis(null) and setNodeEmphasis([]) both restore every node component to unset opacity', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        view.setNodeEmphasis(['a']);
        view.setNodeEmphasis(null);

        expect(view._nodeComponents.get('a').getOpacity()).toBeNull();
        expect(view._nodeComponents.get('b').getOpacity()).toBeNull();

        view.setNodeEmphasis(['a']);
        view.setNodeEmphasis([]);

        expect(view._nodeComponents.get('a').getOpacity()).toBeNull();
        expect(view._nodeComponents.get('b').getOpacity()).toBeNull();
    });

    it('getNodeEmphasis reflects the set and the clear, and hands back a copy', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        view.setNodeEmphasis(['a']);
        const ids = view.getNodeEmphasis();

        expect(ids).toEqual(['a']);

        ids.push('mutated');
        expect(view.getNodeEmphasis()).toEqual(['a']);

        view.setNodeEmphasis(null);
        expect(view.getNodeEmphasis()).toEqual([]);
    });

    it('an emphasis set naming an unknown id dims every node without throwing, and is still reported back', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        expect(() => view.setNodeEmphasis(['nope'])).not.toThrow();

        expect(view._nodeComponents.get('a').getOpacity()).toBe(0.35);
        expect(view._nodeComponents.get('b').getOpacity()).toBe(0.35);
        expect(view.getNodeEmphasis()).toEqual(['nope']);
    });

    it('emits nothing — no "selection", no "layout"', async () => {
        stubEngine = new StubEngine(fixedResult());

        const selectionFired: unknown[] = [];
        const layoutFired: unknown[] = [];
        const view = new StubDiagramView({
            data: simpleGraph(),
            listeners: { selection: () => selectionFired.push(1), layout: () => layoutFired.push(1) },
        }) as any;

        await flush();
        layoutFired.length = 0;

        view.setNodeEmphasis(['a']);

        expect(selectionFired).toHaveLength(0);
        expect(layoutFired).toHaveLength(0);
    });

    it('a setData whose layout lands clears the emphasis', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        view.setNodeEmphasis(['a']);

        view.setData(simpleGraph());
        await flush();

        expect(view.getNodeEmphasis()).toEqual([]);
        expect(view._nodeComponents.get('a').getOpacity()).toBeNull();
        expect(view._nodeComponents.get('b').getOpacity()).toBeNull();
    });

    it('a setData whose layout fails leaves the previous graph\'s emphasis in place', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        view.setNodeEmphasis(['a']);

        stubEngine.layout = (): Promise<DiagramLayoutResult> => Promise.reject(new Error('elkjs unavailable'));

        view.setData(simpleGraph());
        await flush();

        expect(view.getNodeEmphasis()).toEqual(['a']);
        expect(view._nodeComponents.get('a').getOpacity()).toBeNull();
        expect(view._nodeComponents.get('b').getOpacity()).toBe(0.35);
    });
});

describe('DiagramView — an edge press pans but still does not clear the selection', () => {
    it('_handleClick on an edge hit path leaves an existing selection intact and emits no "selection"', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: unknown[] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { selection: () => fired.push(1) } }) as any;

        await flush();
        view.getElement(true);

        view.selectNode('a');

        const hitHandle: Handle = view._edgeLayer._drawn[0].hit;

        view._handleClick(makeEvent(hitHandle, 'click'));

        expect(view.getSelection().map((n: DiagramNodeData) => n.id)).toEqual(['a']);
        expect(fired).toHaveLength(0);
    });

    it('_handlePointerDown on an edge hit path pans, exactly like empty canvas', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        // Forces the whole subtree (including the edge layer's <svg>) to
        // render, so `_drawn` is populated — nothing renders eagerly in this
        // offline harness (see Component.insertComponent: a child's element
        // is only forced when its parent's own element already exists).
        view.getElement(true);

        const hitHandle: Handle = view._edgeLayer._drawn[0].hit;

        view._handlePointerDown(makeEvent(hitHandle, 'pointerdown', { button: 0, clientX: 100, clientY: 100 }));

        expect(view._panning).toBe(true);
        expect(view.getCursor()).toBe('grabbing');
    });

    it('a following pointermove from an edge press pans the content host by the pointer delta', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        view.getElement(true);

        const hitHandle: Handle = view._edgeLayer._drawn[0].hit;

        view._handlePointerDown(makeEvent(hitHandle, 'pointerdown', { button: 0, clientX: 100, clientY: 100 }));
        view._handlePointerMove(makeEvent(hitHandle, 'pointermove', { clientX: 140, clientY: 130, buttons: 1 }));

        expect(view._contentHost.getTransform()).toBe('translate(40px, 30px) scale(1)');
    });

    it('_handleDoubleClick on an edge hit path emits no "activate" (unchanged behaviour, pinned)', async () => {
        stubEngine = new StubEngine(fixedResult());

        const activated: unknown[] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { activate: () => activated.push(1) } }) as any;

        await flush();
        // Forces the whole subtree (including the edge layer's <svg>) to
        // render, so `_drawn` is populated — nothing renders eagerly in this
        // offline harness (see Component.insertComponent: a child's element
        // is only forced when its parent's own element already exists).
        view.getElement(true);

        const hitHandle: Handle = view._edgeLayer._drawn[0].hit;

        view._handleDoubleClick(makeEvent(hitHandle, 'dblclick'));

        expect(activated).toHaveLength(0);
    });

    it('_handleContextMenu on an edge hit path emits no "contextmenu" (unchanged behaviour, pinned)', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: unknown[] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { contextmenu: () => fired.push(1) } }) as any;

        await flush();
        // Forces the whole subtree (including the edge layer's <svg>) to
        // render, so `_drawn` is populated — nothing renders eagerly in this
        // offline harness (see Component.insertComponent: a child's element
        // is only forced when its parent's own element already exists).
        view.getElement(true);

        const hitHandle: Handle = view._edgeLayer._drawn[0].hit;
        const event = makeEvent(hitHandle, 'contextmenu') as any;
        event.preventDefault = () => {};

        view._handleContextMenu(event);

        expect(fired).toHaveLength(0);
    });
});

describe('DiagramView — "edgehover" / "edgeleave"', () => {
    it('emits "edgehover" once with the model edges (data passthrough) and the originating event', async () => {
        stubEngine = new StubEngine(fixedResult());

        const hovered: Array<[unknown[], MouseEvent]> = [];
        const view = new StubDiagramView({
            data: edgeHoverGraph(),
            listeners: { edgehover: (edges, e) => hovered.push([edges, e]) },
        }) as any;

        await flush();
        view.getElement(true);

        // Route for 'e' is (70,35)->(100,215); no pan/zoom applied (identity).
        const hitHandle: Handle = view._edgeLayer._drawn[0].hit;
        const event = makeEvent(hitHandle, 'mousemove', { clientX: 85, clientY: 125 });

        view._handleEdgeMouseMove(event);

        expect(hovered).toHaveLength(1);
        expect((hovered[0][0] as any[]).map((e) => e.id)).toEqual(['e']);
        expect((hovered[0][0] as any[])[0].data).toEqual({ note: 'fk' });
        expect(hovered[0][1]).toBe(event);
    });

    it('a second move at a different point still inside the same edge set emits nothing further', async () => {
        stubEngine = new StubEngine(fixedResult());

        const hovered: unknown[] = [];
        const view = new StubDiagramView({
            data: edgeHoverGraph(),
            listeners: { edgehover: () => hovered.push(1) },
        }) as any;

        await flush();
        // Forces the whole subtree (including the edge layer's <svg>) to
        // render, so `_drawn` is populated — nothing renders eagerly in this
        // offline harness (see Component.insertComponent: a child's element
        // is only forced when its parent's own element already exists).
        view.getElement(true);

        const hitHandle: Handle = view._edgeLayer._drawn[0].hit;

        view._handleEdgeMouseMove(makeEvent(hitHandle, 'mousemove', { clientX: 85, clientY: 125 }));
        view._handleEdgeMouseMove(makeEvent(hitHandle, 'mousemove', { clientX: 86, clientY: 126 }));

        expect(hovered).toHaveLength(1);
    });

    it('a move that leaves the edge emits "edgeleave" once; a further such move emits nothing', async () => {
        stubEngine = new StubEngine(fixedResult());

        const left: unknown[] = [];
        const view = new StubDiagramView({
            data: edgeHoverGraph(),
            listeners: { edgeleave: () => left.push(1) },
        }) as any;

        await flush();
        // Forces the whole subtree (including the edge layer's <svg>) to
        // render, so `_drawn` is populated — nothing renders eagerly in this
        // offline harness (see Component.insertComponent: a child's element
        // is only forced when its parent's own element already exists).
        view.getElement(true);

        const hitHandle: Handle = view._edgeLayer._drawn[0].hit;
        const rootHandle: Handle = view.getElement(true);

        view._handleEdgeMouseMove(makeEvent(hitHandle, 'mousemove', { clientX: 85, clientY: 125 }));
        view._handleEdgeMouseMove(makeEvent(rootHandle, 'mousemove', { clientX: 0, clientY: 0 }));
        view._handleEdgeMouseMove(makeEvent(rootHandle, 'mousemove', { clientX: 1, clientY: 1 }));

        expect(left).toHaveLength(1);
    });

    it('_handleEdgeMouseOut on the edge\'s hit path emits "edgeleave"; on a non-edge target it emits nothing', async () => {
        stubEngine = new StubEngine(fixedResult());

        const left: unknown[] = [];
        const view = new StubDiagramView({
            data: edgeHoverGraph(),
            listeners: { edgeleave: () => left.push(1) },
        }) as any;

        await flush();
        // Forces the whole subtree (including the edge layer's <svg>) to
        // render, so `_drawn` is populated — nothing renders eagerly in this
        // offline harness (see Component.insertComponent: a child's element
        // is only forced when its parent's own element already exists).
        view.getElement(true);

        const hitHandle: Handle = view._edgeLayer._drawn[0].hit;
        const rootHandle: Handle = view.getElement(true);

        view._handleEdgeMouseMove(makeEvent(hitHandle, 'mousemove', { clientX: 85, clientY: 125 }));
        view._handleEdgeMouseOut(makeEvent(rootHandle, 'mouseout'));

        expect(left).toHaveLength(0);

        view._handleEdgeMouseOut(makeEvent(hitHandle, 'mouseout'));

        expect(left).toHaveLength(1);
    });

    it('emits nothing while panning', async () => {
        stubEngine = new StubEngine(fixedResult());

        const hovered: unknown[] = [];
        const view = new StubDiagramView({
            data: edgeHoverGraph(),
            listeners: { edgehover: () => hovered.push(1) },
        }) as any;

        await flush();
        view.getElement(true);

        view._panning = true;

        const hitHandle: Handle = view._edgeLayer._drawn[0].hit;
        view._handleEdgeMouseMove(makeEvent(hitHandle, 'mousemove', { clientX: 85, clientY: 125 }));

        expect(hovered).toHaveLength(0);
    });

    it('applies the pan/zoom inverse before hit-testing: a mapped point off the route emits nothing, one on the route emits "edgehover"', async () => {
        stubEngine = new StubEngine(fixedResult());

        const hovered: unknown[] = [];
        const view = new StubDiagramView({
            data: edgeHoverGraph(),
            listeners: { edgehover: () => hovered.push(1) },
        }) as any;

        await flush();
        view.getElement(true);

        view._panX = 100;
        view._panY = 50;
        view.setZoom(2);

        const hitHandle: Handle = view._edgeLayer._drawn[0].hit;

        // Client (100, 50) maps to graph (0, 0) with this pan/zoom — far from
        // the route (70,35)-(100,215).
        view._handleEdgeMouseMove(makeEvent(hitHandle, 'mousemove', { clientX: 100, clientY: 50 }));
        expect(hovered).toHaveLength(0);

        // Client (270, 300) maps to graph (85, 125) — the route's midpoint.
        view._handleEdgeMouseMove(makeEvent(hitHandle, 'mousemove', { clientX: 270, clientY: 300 }));
        expect(hovered).toHaveLength(1);
    });
});

// U11 — compound (container) nodes: rebuildNodes/collectNodeSizes recurse into
// `children`, containers render via groupRenderer, and z-index is only
// touched when the graph actually has a container (flat graphs unaffected).

function compoundGraph(): DiagramData {
    return {
        nodes: [
            {
                id: 'schema:public', label: 'public',
                children: [{ id: 'public.users', label: 'users' }, { id: 'public.orders', label: 'orders' }],
            },
        ],
        edges: [{ id: 'e', source: 'public.users', target: 'public.orders' }],
    };
}

function compoundResult(): DiagramLayoutResult {
    return {
        nodes: [
            { id: 'schema:public', x: 0, y: 0, width: 200, height: 150 },
            { id: 'public.users', x: 10, y: 10, width: 60, height: 30 },
            { id: 'public.orders', x: 10, y: 60, width: 60, height: 30 },
        ],
        edges: [{ id: 'e', sections: [] }],
        width:  200,
        height: 150,
    };
}

describe('DiagramView — compound container nodes (U11)', () => {
    it('registers the container and its children in _nodeComponents/_nodeData, building the container via groupRenderer', async () => {
        stubEngine = new StubEngine(compoundResult());

        const built: string[] = [];
        const groupRenderer = (d: DiagramNodeData): Component => {
            built.push(d.id);

            return new Component({ preferredSize: { width: 10, height: 10 } });
        };

        const view = new StubDiagramView({ data: compoundGraph(), groupRenderer }) as any;

        await flush();

        expect(built).toEqual(['schema:public']);
        expect([...view._nodeComponents.keys()]).toEqual(['schema:public', 'public.users', 'public.orders']);
        expect(view._nodeData.get('public.users').label).toBe('users');
    });

    it('defaults the container renderer to a DiagramGroupNode carrying the container\'s label', async () => {
        stubEngine = new StubEngine(compoundResult());

        const view = new StubDiagramView({ data: compoundGraph() }) as any;

        await flush();

        const container = view._nodeComponents.get('schema:public');

        expect(container.getLabel?.()).toBe('public');
    });

    it('positions every flattened node (container + leaves) at its absolute layout coords', async () => {
        stubEngine = new StubEngine(compoundResult());

        const view = new StubDiagramView({ data: compoundGraph() }) as any;

        await flush();

        const container = view._nodeComponents.get('schema:public');
        const users = view._nodeComponents.get('public.users');

        expect([container.getX(), container.getY()]).toEqual([0, 0]);
        expect([users.getX(), users.getY()]).toEqual([10, 10]);
    });

    it('z-indexes containers below the edge layer and leaves above it, when the graph has a container', async () => {
        stubEngine = new StubEngine(compoundResult());

        const view = new StubDiagramView({ data: compoundGraph() }) as any;

        await flush();

        const container = view._nodeComponents.get('schema:public');
        const users = view._nodeComponents.get('public.users');
        const orders = view._nodeComponents.get('public.orders');

        expect(container.getZIndex()).toBe(0);
        expect(view._edgeLayer.getZIndex()).toBe(1);
        expect(users.getZIndex()).toBe(2);
        expect(orders.getZIndex()).toBe(2);
    });

    it('leaves z-index untouched for a flat (no-container) graph', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        const nodeA = view._nodeComponents.get('a');

        expect(nodeA.getZIndex()).toBe(0);
        expect(view._edgeLayer.getZIndex()).toBe(0);
    });

    it('resets the edge layer\'s z-index when a flat setData follows a compound one on the same (persistent, never-rebuilt) view', async () => {
        // The edge layer is a persistent child of the content host — built once
        // in the constructor, never torn down/recreated by setData/rebuildNodes
        // — unlike node components, which are always freshly built (so a fresh
        // leaf/container naturally starts at the Component default z-index).
        // A z-index written by an earlier compound pass must not leak into a
        // later flat pass on that same edge layer instance.
        let call = 0;
        const results = [compoundResult(), fixedResult()];
        stubEngine = { layout: () => Promise.resolve(results[call++]) } as unknown as StubEngine;

        const view = new StubDiagramView({ data: compoundGraph() }) as any;

        await flush();
        expect(view._edgeLayer.getZIndex()).toBe(1);

        view.setData(simpleGraph());

        await flush();
        expect(view._edgeLayer.getZIndex()).toBe(0);
        expect(view._nodeComponents.get('a').getZIndex()).toBe(0);
    });

    it('collectNodeSizes feeds every node (container + leaves) to the ELK sizes map', async () => {
        stubEngine = new StubEngine(compoundResult());

        const view = new StubDiagramView({ data: compoundGraph() }) as any;

        await flush();

        const sizes = stubEngine.lastArgs!.sizes;

        expect(sizes.has('schema:public')).toBe(true);
        expect(sizes.has('public.users')).toBe(true);
        expect(sizes.has('public.orders')).toBe(true);
    });

    it('does not forward badge to the default group renderer', async () => {
        stubEngine = new StubEngine(compoundResult());

        const graph = compoundGraph();

        graph.nodes[0].badge = '+1→'; // a container carrying a badge

        const view = new StubDiagramView({ data: graph }) as any;

        await flush();

        const container = view._nodeComponents.get('schema:public');

        expect(container.getBadge).toBeUndefined();
    });
});

describe('DiagramView — badge passthrough (default node renderer)', () => {
    it('renders a node\'s badge into a DiagramNode whose getBadge() returns it', async () => {
        stubEngine = new StubEngine(fixedResult());

        const graph = simpleGraph();

        graph.nodes[0].badge = '+3→';

        const view = new StubDiagramView({ data: graph }) as any;

        await flush();

        expect(view._nodeComponents.get('a').getBadge()).toBe('+3→');
        expect(view._nodeComponents.get('b').getBadge()).toBeNull();
    });
});

// Disposal. The view owns its engine's lifetime: tearing the view down must
// dispose the engine (which is what releases the ELK Web Worker), and a layout
// still in flight at that moment must not write back into the torn-down view.

describe('DiagramView — disposal', () => {
    it('D1: disposing the view disposes its engine', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;
        await flush();

        view.dispose();

        expect(stubEngine.disposed).toBe(1);
    });

    it('D2: disposing twice does not throw', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;
        await flush();

        view.dispose();

        expect(() => view.dispose()).not.toThrow();
    });

    it('D3: a layout resolving after disposal is dropped, not applied', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView({ data: simpleGraph() }) as any;
        await flush();

        const layouts: number[] = [];
        view.on('layout', () => layouts.push(1));

        view.dispose();
        stubEngine.resolveDeferred(0, fixedResult());

        await flush();

        expect(layouts).toEqual([]);
    });

    it('D4: a layout rejecting after disposal does not strip the view\'s nodes', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        // No `await flush()` here: the first layout must still be genuinely
        // in flight (its deferred unresolved) when dispose() below runs.
        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        expect(view._incomingComponents.size).toBe(2);

        view.dispose();
        stubEngine.rejectDeferred(0, new Error('elkjs unavailable'));

        await flush();

        // `handleLayoutFailure` discards the incoming nodes when it runs, so
        // an untouched incoming map is what proves its generation guard
        // dropped this stale failure. Asserting only "no unhandled
        // rejection" would pass for any implementation — `relayout` always
        // attaches a `.catch`.
        expect(view._incomingComponents.size).toBe(2);
    });

    it('D5: a setData that swaps out a node generation disposes the evicted components, not just detaches them', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;
        await flush();

        const nodeA = view._nodeComponents.get('a');
        const nodeB = view._nodeComponents.get('b');
        const disposeA = vi.spyOn(nodeA, 'dispose');
        const disposeB = vi.spyOn(nodeB, 'dispose');

        view.setData({ nodes: [{ id: 'c' }, { id: 'd' }], edges: [] });
        await flush();

        expect(disposeA).toHaveBeenCalledTimes(1);
        expect(disposeB).toHaveBeenCalledTimes(1);
        expect(view._contentHost.getComponents()).not.toContain(nodeA);
        expect(view._contentHost.getComponents()).not.toContain(nodeB);
    });
});

describe('DiagramView — resetView targets the focus node', () => {
    it('re-centres on the focus node rather than the graph bounds', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph(), initialFocusNode: 'a' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        // Stand in for a pan the user has dragged to since the initial centring.
        view._panX = 99;
        view._panY = 77;
        view.applyTransformToHost();

        view.resetView();

        // Node 'a' is at (10, 20, 60, 30) → centre (40, 35).
        expect(view._contentHost.getTransform()).toBe('translate(600px, 365px) scale(1)');
    });

    it('recovers the root after a live re-layout, leaving the one-shot rule intact', async () => {
        let call = 0;

        // A custom stub (mirroring the failed-re-layout test above) since a
        // single StubEngine instance can only return one fixed result — this
        // needs the first layout to settle on fixedResult() and a later
        // setData (standing in for a Depth-control change) to relayout onto
        // movedRootResult(), which keeps node 'a' but moves it far from where
        // the first layout put it.
        stubEngine = {
            layout: (): Promise<DiagramLayoutResult> => {
                call += 1;

                return call === 1 ? Promise.resolve(fixedResult()) : Promise.resolve(movedRootResult());
            },
            dispose: () => {},
        } as unknown as StubEngine;

        const view = new StubDiagramView({ data: simpleGraph(), initialFocusNode: 'a' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        expect(view._contentHost.getTransform()).toBe('translate(600px, 365px) scale(1)');

        view.setData(simpleGraph());
        await flush();

        // One-shot: the re-layout alone must not re-arm the centring.
        expect(view._contentHost.getTransform()).toBe('translate(600px, 365px) scale(1)');

        view.resetView();

        // Node 'a' is now at (500, 400, 60, 30) → centre (530, 415).
        expect(view._contentHost.getTransform()).toBe('translate(110px, -15px) scale(1)');
    });

    it('falls back to the graph bounds when the focus node is gone from the new graph', async () => {
        let call = 0;

        stubEngine = {
            layout: (): Promise<DiagramLayoutResult> => {
                call += 1;

                return call === 1
                    ? Promise.resolve(fixedResult())
                    : Promise.resolve({ nodes: [{ id: 'z', x: 0, y: 0, width: 20, height: 20 }], edges: [], width: 400, height: 300 });
            },
            dispose: () => {},
        } as unknown as StubEngine;

        const view = new StubDiagramView({ data: simpleGraph(), initialFocusNode: 'a' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        // The second setData's own graph must also drop node 'a' — a node
        // component only exists when the DiagramData passed to setData names
        // it; the stub's ELK result merely supplies its position.
        view.setData({ nodes: [{ id: 'z', label: 'Z' }], edges: [] });
        await flush();

        view.resetView();

        expect(view._contentHost.getTransform()).toBe('translate(440px, 250px) scale(1)');
    });

    it('re-arms the retry when resetView runs before the view is sized', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        view.resetView();

        expect(view._contentHost.getTransform()).toBe('translate(0px, 0px) scale(1)');
        expect(view._needsInitialCentre).toBe(true);

        vi.spyOn(DOM.source, 'isConnected').mockReturnValue(true);
        view.getElement(true);
        view.setSize({ width: 1280, height: 800 });
        view.doLayout();

        expect(view._contentHost.getTransform()).toBe('translate(560px, 285px) scale(1)');

        vi.restoreAllMocks();
    });

    it('is a no-op when sized but no data has ever been laid out', () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView() as any;

        view.setSize({ width: 1280, height: 800 });
        view.resetView();

        expect(view._contentHost.getTransform()).toBe('translate(0px, 0px) scale(1)');
    });
});

describe('DiagramView — centring a node fits it in the viewport', () => {
    it('lowers the zoom on the initial centring so an oversized root fits whole', async () => {
        stubEngine = new StubEngine(oversizedNodeResult());

        const view = new StubDiagramView({ data: simpleGraph(), initialFocusNode: 'a' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        // Node 'a' is at (100, 50, 2000, 1000); fit zoom min(0.64, 0.8) = 0.64.
        expect(view._contentHost.getTransform()).toBe('translate(-64px, 48px) scale(0.64)');
    });

    it('revealNode lowers the zoom so an oversized node fits whole', async () => {
        stubEngine = new StubEngine(oversizedNodeResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();
        view.setSize({ width: 1280, height: 800 });

        // Commits each node's real preferred size before revealNode reads it
        // (see the analogous comment on the revealNode test above).
        view._contentHost.doLayout();

        view.revealNode('a');

        expect(view._contentHost.getTransform()).toBe('translate(-64px, 48px) scale(0.64)');
    });

    it('never raises the zoom above the configured value when the node already fits', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph(), initialFocusNode: 'a', zoom: 0.5 }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        expect(view._contentHost.getTransform()).toBe('translate(620px, 382.5px) scale(0.5)');
    });

    it('lets the node fit override a configured minZoom that would otherwise block it', async () => {
        stubEngine = new StubEngine({
            nodes: [{ id: 'a', x: 0, y: 0, width: 2000, height: 1000 }],
            edges: [],
            width:  2000,
            height: 1000,
        });

        const view = new StubDiagramView({ data: simpleGraph(), initialFocusNode: 'a', minZoom: 1 }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        // effectiveMinZoom drops the floor to the graph's own fit zoom (0.64),
        // which here equals the node's — the configured minZoom: 1 never binds.
        expect(view._contentHost.getTransform()).toBe('translate(0px, 80px) scale(0.64)');
    });

    it('resetView shrinks the zoom to fit the focus node even after a manual zoom-in', async () => {
        stubEngine = new StubEngine(oversizedNodeResult());

        const view = new StubDiagramView({ data: simpleGraph(), initialFocusNode: 'a' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        view.setZoom(2);
        view.resetView();

        // The default zoom is restored first, then lowered to fit.
        expect(view._contentHost.getTransform()).toBe('translate(-64px, 48px) scale(0.64)');
    });

    it('revealNode on an unsized view writes neither pan nor zoom', async () => {
        stubEngine = new StubEngine(oversizedNodeResult());

        const view = new StubDiagramView({ data: simpleGraph(), zoom: 2 }) as any;

        await flush();

        view.revealNode('a');

        expect(view.getZoom()).toBe(2);
        expect(view._contentHost.getTransform()).toBe('translate(0px, 0px) scale(2)');
    });
});

describe('DiagramView — busy indicator during a layout pass', () => {
    it('shows the overlay for the duration of a deferred layout pass, hides it once it resolves', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView() as any;
        view.setSize({ width: 1280, height: 800 });

        view.setData(simpleGraph());

        expect(view._busySpinner.isOverlay()).toBe(true);

        stubEngine.resolveDeferred(0, fixedResult());
        await flush();

        expect(view._busySpinner.isOverlay()).toBe(false);
    });

    it('shows the overlay for the duration of a rejecting layout pass (ELK absent)', async () => {
        stubEngine = new StubEngine(fixedResult(), 'reject');

        const view = new StubDiagramView() as any;
        view.setSize({ width: 1280, height: 800 });

        view.setData(simpleGraph());

        expect(view._busySpinner.isOverlay()).toBe(true);

        await flush();

        expect(view._busySpinner.isOverlay()).toBe(false);
    });

    it('never builds the spinner for an unsized view', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView() as any;

        view.setData(simpleGraph());

        expect(view._busySpinner).toBeNull();

        stubEngine.resolveDeferred(0, fixedResult());
        await flush();

        expect(view._busySpinner).toBeNull();
    });

    it('keeps the overlay shown across two rapid setData calls sharing one busy span', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView() as any;
        view.setSize({ width: 1280, height: 800 });

        view.setData({ nodes: [{ id: 'a' }], edges: [] }); // generation 1 → deferred[0]
        expect(view._busySpinner.isOverlay()).toBe(true);

        view.setData({ nodes: [{ id: 'b' }], edges: [] }); // generation 2 → deferred[1]
        expect(view._busySpinner.isOverlay()).toBe(true);

        // The stale first deferred settling nothing — resolving it is a no-op
        // because its generation no longer matches.
        stubEngine.resolveDeferred(0, { nodes: [{ id: 'a', x: 0, y: 0, width: 10, height: 10 }], edges: [], width: 10, height: 10 });
        await flush();

        expect(view._busySpinner.isOverlay()).toBe(true);

        stubEngine.resolveDeferred(1, { nodes: [{ id: 'b', x: 0, y: 0, width: 10, height: 10 }], edges: [], width: 10, height: 10 });
        await flush();

        expect(view._busySpinner.isOverlay()).toBe(false);
    });

    it('picks up the overlay once a previously unsized view is given a size mid-pass', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView() as any;

        view.setData(simpleGraph());

        expect(view._busySpinner).toBeNull();

        view.setSize({ width: 1280, height: 800 });
        view.doLayout();

        expect(view._busySpinner.isOverlay()).toBe(true);

        stubEngine.resolveDeferred(0, fixedResult());
        await flush();

        expect(view._busySpinner.isOverlay()).toBe(false);
    });

    it('disposal hides the overlay and drops the spinner', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView() as any;
        view.setSize({ width: 1280, height: 800 });

        view.setData(simpleGraph());

        const spinner = view._busySpinner;
        expect(spinner.isOverlay()).toBe(true);

        view.dispose();

        expect(spinner.isOverlay()).toBe(false);
        expect(view._busySpinner).toBeNull();
    });

    it('leaves the spinner built but hidden after a same-tick-resolving pass on a sized view', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView() as any;
        view.setSize({ width: 1280, height: 800 });

        view.setData(simpleGraph());
        await flush();

        expect(view._busySpinner).not.toBeNull();
        expect(view._busySpinner.isOverlay()).toBe(false);

        view.doLayout();

        expect(view._busySpinner.isOverlay()).toBe(false);
    });
});

describe('DiagramView — incoming nodes mount only once placed', () => {
    it('keeps incoming components off the content host, hidden, until the layout lands', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        const hostComponents = view._contentHost.getComponents();

        expect(view._incomingComponents.size).toBe(2);

        for (const component of view._incomingComponents.values()) {
            expect(hostComponents).not.toContain(component);
            expect(component.isVisible()).toBe(false);
        }

        stubEngine.resolveDeferred(0, fixedResult());
        await flush();
    });

    it('mounts and reveals every node component together once ELK has placed them', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        // Sized: an unsized view now mounts nothing at all (node
        // virtualization — see the plan's Expected Behaviour §B), so this
        // "mounts everything" case needs a viewport whose residency rect
        // covers the whole (small) graph to still observe that outcome.
        view.setSize({ width: 1280, height: 800 });

        stubEngine.resolveDeferred(0, fixedResult());
        await flush();

        const hostComponents = view._contentHost.getComponents();

        for (const component of view._nodeComponents.values()) {
            expect(hostComponents).toContain(component);
            expect(component.isVisible()).toBe(true);
        }

        expect(view._nodeComponents.get('a').getX()).toBe(10);
        expect(view._nodeComponents.get('a').getY()).toBe(20);
    });

    it('leaves the shown graph mounted while a re-layout is pending, mounting only once it lands', async () => {
        stubEngine = new StubEngine(fixedResult(), 'defer');

        const view = new StubDiagramView() as any;

        // Sized for the same reason as the test above — the assertions below
        // check content-host membership, which only reflects mounting on a
        // sized view under node virtualization.
        view.setSize({ width: 1280, height: 800 });

        view.setData({ nodes: [{ id: 'a' }], edges: [] }); // generation 1 → deferred[0]
        stubEngine.resolveDeferred(0, { nodes: [{ id: 'a', x: 1, y: 1, width: 10, height: 10 }], edges: [], width: 10, height: 10 });
        await flush();

        const shown = view._nodeComponents.get('a');
        expect(view._contentHost.getComponents()).toContain(shown);

        view.setData({ nodes: [{ id: 'z' }], edges: [] }); // generation 2 → deferred[1]

        const incoming = view._incomingComponents.get('z');
        expect(view._contentHost.getComponents()).toContain(shown);
        expect(shown.isVisible()).toBe(true);
        expect(view._contentHost.getComponents()).not.toContain(incoming);
        expect(incoming.isVisible()).toBe(false);

        stubEngine.resolveDeferred(1, { nodes: [{ id: 'z', x: 9, y: 9, width: 20, height: 20 }], edges: [], width: 20, height: 20 });
        await flush();

        expect(view._contentHost.getComponents()).toContain(incoming);
        expect(view._contentHost.getComponents()).not.toContain(shown);
    });

    it('mounts nothing when the first layout fails', async () => {
        stubEngine = new StubEngine(fixedResult(), 'reject');

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        await flush();

        expect(view._nodeComponents.size).toBe(0);
        expect(view._incomingComponents.size).toBe(0);
        expect(view._contentHost.getComponents()).toEqual([view._edgeLayer]);
    });

    it('leaves the first graph mounted when a re-layout fails', async () => {
        let call = 0;

        stubEngine = {
            layout: (): Promise<DiagramLayoutResult> => {
                call += 1;

                return call === 1 ? Promise.resolve(fixedResult()) : Promise.reject(new Error('elkjs unavailable'));
            },
            dispose: () => {},
        } as unknown as StubEngine;

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        // Sized for the same reason as the tests above — content-host
        // membership only reflects mounting on a sized view under node
        // virtualization.
        view.setSize({ width: 1280, height: 800 });
        await flush();

        const shown = [...view._nodeComponents.values()];
        expect(shown.length).toBe(2);

        for (const component of shown) {
            expect(view._contentHost.getComponents()).toContain(component);
        }

        view.setData(simpleGraph());
        await flush();

        for (const component of shown) {
            expect(view._contentHost.getComponents()).toContain(component);
        }
    });
});

/** A graph with one node near the origin and one node far enough away that a 1280×800 viewport never mounts both at once. */
function farGraph(): DiagramData {
    return {
        nodes: [{ id: 'a', label: 'A' }, { id: 'far', label: 'Far' }],
        edges: [],
    };
}

/** The layout result for {@link farGraph}: `a` at (10, 20), `far` at (40000, 0), both 60×30. */
function farResult(): DiagramLayoutResult {
    return {
        nodes: [
            { id: 'a',   x: 10,    y: 20, width: 60, height: 30 },
            { id: 'far', x: 40000, y: 0,  width: 60, height: 30 },
        ],
        edges: [],
        width:  40060,
        height: 230,
    };
}

describe('DiagramView — node virtualization: only the resident set is mounted', () => {
    it('a sized view mounts only the node near the viewport, both still in _nodeComponents at their laid-out coords', async () => {
        stubEngine = new StubEngine(farResult());

        const view = new StubDiagramView({ data: farGraph(), initialFocusNode: 'a' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        // initialFocusNode centres node 'a' (10, 20, 60, 30) → pan (600, 365),
        // matching the `initialFocusNode` describe block's own worked value.
        expect(view._contentHost.getTransform()).toBe('translate(600px, 365px) scale(1)');

        const hostComponents = view._contentHost.getComponents();
        const nodeA = view._nodeComponents.get('a');
        const nodeFar = view._nodeComponents.get('far');

        expect(hostComponents).toContain(nodeA);
        expect(hostComponents).not.toContain(nodeFar);

        expect(nodeA.getX()).toBe(10);
        expect(nodeA.getY()).toBe(20);
        expect(nodeFar.getX()).toBe(40000);
        expect(nodeFar.getY()).toBe(0);
    });

    it('an unsized view mounts nothing, while _nodeComponents still holds every node', async () => {
        stubEngine = new StubEngine(farResult());

        const view = new StubDiagramView({ data: farGraph() }) as any;

        await flush();

        expect(view._residentIds.size).toBe(0);
        expect(view._nodeComponents.size).toBe(2);
    });

    it('panning past the trigger rect mounts the newly-near node and unmounts the one left behind; ' +
       'a smaller pan that stays inside the trigger rect changes nothing', async () => {
        // 'a' at (-100, 20, 60, 30), 'near' at (2000, 0, 60, 30): the initial
        // centring on 'a' leaves 'near' outside the residency rect, a small
        // drag stays inside the trigger rect, and a large enough drag both
        // brings 'near' in and pushes 'a' out.
        const data: DiagramData = { nodes: [{ id: 'a' }, { id: 'near' }], edges: [] };
        const result: DiagramLayoutResult = {
            nodes: [
                { id: 'a',    x: -100, y: 20, width: 60, height: 30 },
                { id: 'near', x: 2000, y: 0,  width: 60, height: 30 },
            ],
            edges: [], width: 2100, height: 230,
        };

        stubEngine = new StubEngine(result);

        const view = new StubDiagramView({ data, initialFocusNode: 'a' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        // Centred on 'a' (-100, 20, 60, 30) → centre (-70, 35) → pan (710, 365).
        expect(view._contentHost.getTransform()).toBe('translate(710px, 365px) scale(1)');

        const nodeA = view._nodeComponents.get('a');
        const nodeNear = view._nodeComponents.get('near');
        const initialResident = new Set(view._residentIds);

        expect(initialResident).toEqual(new Set(['a']));

        const empty: Handle = view.getElement(true);

        view._handlePointerDown(makeEvent(empty, 'pointerdown', { button: 0, clientX: 1500, clientY: 800 }));

        // A drag of +50px stays inside the trigger rect (committed inflated
        // by half the margin) — the resident set must not change.
        view._handlePointerMove(makeEvent(empty, 'pointermove', { clientX: 1550, clientY: 800, buttons: 1 }));

        expect(view._residentIds).toEqual(initialResident);

        // Continuing the same drag to a cumulative -1400px escapes the
        // trigger rect: 'near' comes into range, 'a' falls out of it.
        view._handlePointerMove(makeEvent(empty, 'pointermove', { clientX: 100, clientY: 800, buttons: 1 }));

        expect(view._residentIds).toEqual(new Set(['near']));
        expect(view._contentHost.getComponents()).toContain(nodeNear);
        expect(view._contentHost.getComponents()).not.toContain(nodeA);
    });

    it('a zoom always recomputes the residency rect, even though the smaller pre-zoom rect would still be contained', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        const before = { ...view._residencyViewport };

        view.zoomOut();

        expect(view._residencyViewport.width).not.toBe(before.width);
        expect(view._residencyViewport.height).not.toBe(before.height);
    });

    it('focusNode mounts its target', async () => {
        stubEngine = new StubEngine(farResult());

        const view = new StubDiagramView({ data: farGraph() }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        view.focusNode('far');

        // Node 'far' is at (40000, 0, 60, 30) → centre (40030, 15).
        expect(view._contentHost.getTransform()).toBe('translate(-39390px, 385px) scale(1)');
        expect(view._contentHost.getComponents()).toContain(view._nodeComponents.get('far'));
    });

    it('zoomToFit needs no node mounted and leaves the residency set matching the new (whole-graph) viewport', async () => {
        stubEngine = new StubEngine(farResult());

        const view = new StubDiagramView({ data: farGraph(), initialFocusNode: 'a' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        // 'far' is unmounted at this point (see the first test in this block).
        expect(view._contentHost.getComponents()).not.toContain(view._nodeComponents.get('far'));

        expect(() => view.zoomToFit()).not.toThrow();

        // At fit-the-whole-graph zoom, every node is in view and therefore mounted.
        expect(view._contentHost.getComponents()).toContain(view._nodeComponents.get('a'));
        expect(view._contentHost.getComponents()).toContain(view._nodeComponents.get('far'));
    });

    it('resetView re-centres on, and mounts, an unmounted focus node', async () => {
        stubEngine = new StubEngine(farResult());

        const view = new StubDiagramView({ data: farGraph(), initialFocusNode: 'far' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        expect(view._contentHost.getComponents()).toContain(view._nodeComponents.get('far'));

        // Pan away to somewhere near 'a', unmounting 'far'.
        view._panX = 0;
        view._panY = 0;
        view.applyTransformToHost();

        expect(view._contentHost.getComponents()).not.toContain(view._nodeComponents.get('far'));

        view.resetView();

        expect(view._contentHost.getTransform()).toBe('translate(-39390px, 385px) scale(1)');
        expect(view._contentHost.getComponents()).toContain(view._nodeComponents.get('far'));
    });

    it('selection survives an unmount / remount cycle', async () => {
        stubEngine = new StubEngine(farResult());

        const view = new StubDiagramView({ data: farGraph(), initialFocusNode: 'a' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        expect(view._contentHost.getComponents()).not.toContain(view._nodeComponents.get('far'));

        view.selectNode('far');

        expect(view.getSelection()[0].id).toBe('far');

        // Pan onto 'far', mounting it (and unmounting 'a').
        view._panX = -39390;
        view._panY = 385;
        view.applyTransformToHost();

        expect(view._contentHost.getComponents()).toContain(view._nodeComponents.get('far'));
        expect(view._nodeComponents.get('far').isSelected()).toBe(true);
        expect(view.getSelection()[0].id).toBe('far');
    });

    it('node emphasis survives the same unmount / remount cycle', async () => {
        stubEngine = new StubEngine(farResult());

        const view = new StubDiagramView({ data: farGraph(), initialFocusNode: 'a' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        view.setNodeEmphasis(['a']);

        expect(view._contentHost.getComponents()).not.toContain(view._nodeComponents.get('far'));

        // Pan onto 'far', mounting it (and unmounting 'a').
        view._panX = -39390;
        view._panY = 385;
        view.applyTransformToHost();

        expect(view._nodeComponents.get('far').getOpacity()).toBe(0.35);
        expect(view._nodeComponents.get('a').getOpacity()).toBeNull();
    });

    it('a replaced graph disposes every previous node component and rebuilds residency from scratch', async () => {
        let call = 0;
        const results = [farResult(), fixedResult()];

        stubEngine = { layout: (): Promise<DiagramLayoutResult> => Promise.resolve(results[call++]), dispose: (): void => {} } as unknown as StubEngine;

        const view = new StubDiagramView({ data: farGraph() }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        const oldA = view._nodeComponents.get('a');
        const oldFar = view._nodeComponents.get('far');
        const disposeA = vi.spyOn(oldA, 'dispose');
        const disposeFar = vi.spyOn(oldFar, 'dispose');

        // Reset the pan to the origin so the second (near-origin) graph's
        // nodes land inside the residency rect once it's promoted.
        view._panX = 0;
        view._panY = 0;
        view.applyTransformToHost();

        view.setData(simpleGraph());
        await flush();

        expect(disposeA).toHaveBeenCalledTimes(1);
        expect(disposeFar).toHaveBeenCalledTimes(1);

        expect(view._residentIds).toEqual(new Set(['a', 'b']));

        const hostComponents = view._contentHost.getComponents();
        expect(hostComponents).toHaveLength(3);
        expect(hostComponents).toContain(view._edgeLayer);
        expect(hostComponents).toContain(view._nodeComponents.get('a'));
        expect(hostComponents).toContain(view._nodeComponents.get('b'));
    });

    it('a failed re-layout leaves the mounted set exactly as the first graph left it', async () => {
        let call = 0;

        stubEngine = {
            layout: (): Promise<DiagramLayoutResult> => {
                call += 1;

                return call === 1 ? Promise.resolve(farResult()) : Promise.reject(new Error('elkjs unavailable'));
            },
            dispose: (): void => {},
        } as unknown as StubEngine;

        const view = new StubDiagramView({ data: farGraph(), initialFocusNode: 'a' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        const residentBefore = new Set(view._residentIds);
        const hostBefore = [...view._contentHost.getComponents()];

        view.setData(farGraph());
        await flush();

        expect(view._residentIds).toEqual(residentBefore);
        expect(view._contentHost.getComponents()).toEqual(hostBefore);
    });

    it('disposal disposes both a node that was never mounted and one that was mounted then unmounted', async () => {
        const data: DiagramData = { nodes: [{ id: 'a' }, { id: 'far' }, { id: 'other' }], edges: [] };
        const result: DiagramLayoutResult = {
            nodes: [
                { id: 'a',     x: 10,     y: 20, width: 60, height: 30 },
                { id: 'far',   x: 40000,  y: 0,  width: 60, height: 30 },
                { id: 'other', x: -40000, y: 0,  width: 60, height: 30 },
            ],
            edges: [], width: 80120, height: 230,
        };

        stubEngine = new StubEngine(result);

        const view = new StubDiagramView({ data, initialFocusNode: 'a' }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        // 'a' is mounted (the initial focus); 'far' has never been mounted.
        expect(view._residentIds).toEqual(new Set(['a']));

        // Pan onto 'other', which mounts it and unmounts 'a' — 'a' is now the
        // "mounted then unmounted" case, 'far' stays the "never mounted" one.
        view._panX = 40610;
        view._panY = 385;
        view.applyTransformToHost();

        expect(view._residentIds).toEqual(new Set(['other']));

        const nodeA = view._nodeComponents.get('a');
        const nodeFar = view._nodeComponents.get('far');
        const disposeA = vi.spyOn(nodeA, 'dispose');
        const disposeFar = vi.spyOn(nodeFar, 'dispose');

        view.dispose();

        expect(disposeA).toHaveBeenCalledTimes(1);
        expect(disposeFar).toHaveBeenCalledTimes(1);
    });

    it('a mounted node is sized before it renders, with no intervening layout pass', async () => {
        stubEngine = new StubEngine(fixedResult());

        const view = new StubDiagramView({ data: simpleGraph() }) as any;

        view.setSize({ width: 1280, height: 800 });
        await flush();

        // No `view._contentHost.doLayout()` call here — the point of this
        // test is that `mountNode` itself commits the size, without waiting
        // for the (RAF-swallowed-in-tests) content host layout pass other
        // tests in this file explicitly force.
        const nodeA = view._nodeComponents.get('a');

        expect(nodeA.getWidth()).toBe(60);
        expect(nodeA.getHeight()).toBe(30);
    });
});
