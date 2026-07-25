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
        expect(() => Event.addSubtreeListener(other, 'wheel', () => {}, { passive: true })).toThrow();
        expect(() => Event.addSubtreeListener(other, 'wheel', () => {}, { passive: false })).not.toThrow();
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
        let prevented = false;
        event.preventDefault = () => { prevented = true; };

        view._handleContextMenu(event);

        expect(fired).toHaveLength(1);
        expect(fired[0][0].id).toBe('a');
        expect(prevented).toBe(true);
    });

    it('fires no "contextmenu" and does not prevent default on empty canvas', async () => {
        stubEngine = new StubEngine(fixedResult());

        const fired: unknown[] = [];
        const view = new StubDiagramView({ data: simpleGraph(), listeners: { contextmenu: () => fired.push(1) } }) as any;

        await flush();

        const empty: Handle = view.getElement(true);
        const event = makeEvent(empty, 'contextmenu') as any;
        let prevented = false;
        event.preventDefault = () => { prevented = true; };

        view._handleContextMenu(event);

        expect(fired).toHaveLength(0);
        expect(prevented).toBe(false);
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

describe('DiagramView — option routing (U9, extended by behaviour 15)', () => {
    it('routes every option to its setter and wires the listeners bag, including controls and contextmenu', async () => {
        stubEngine = new StubEngine(fixedResult());

        const layoutFired: number[] = [];
        const customNodes: DiagramNodeData[] = [];
        const contextMenuFired: DiagramNodeData[] = [];

        const view = new StubDiagramView({
            data:          simpleGraph(),
            layoutOptions: { 'elk.algorithm': 'layered' },
            minZoom:       0.5,
            maxZoom:       8,
            zoom:          2,
            controls:      false,
            nodeRenderer:  (n) => { customNodes.push(n); return new Component({ preferredSize: { width: 30, height: 20 } }); },
            listeners:     { layout: () => layoutFired.push(1), contextmenu: (n) => contextMenuFired.push(n) },
        }) as any;

        await flush();

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
});
